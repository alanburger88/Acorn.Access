import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { newId } from './ids.js';

/**
 * CloudEvents 1.0-shaped envelope. `type` values follow the taxonomy in
 * platform/04-architecture.md, e.g. `com.acorn.communication.composed`.
 */
export interface PlatformEvent<T = unknown> {
  specversion: '1.0';
  id: string;
  type: string;
  source: string;
  time: string;
  tenantid: string;
  /** Entity the event is about, e.g. `com_...` or `dlv_...`. */
  subject?: string;
  data: T;
}

export interface StoredEvent extends PlatformEvent {
  seq: number;
  /** sha256 over (prevhash + canonical event json) — tamper-evident chain. */
  hash: string;
  prevhash: string;
}

export type EventHandler = (event: PlatformEvent) => void | Promise<void>;

export function makeEvent<T>(args: {
  type: string;
  tenantId: string;
  source: string;
  subject?: string;
  data: T;
  time?: string;
}): PlatformEvent<T> {
  return {
    specversion: '1.0',
    id: newId('evt'),
    type: args.type,
    source: args.source,
    time: args.time ?? new Date().toISOString(),
    tenantid: args.tenantId,
    subject: args.subject,
    data: args.data,
  };
}

/**
 * In-process pub/sub. Handlers are awaited sequentially; a handler failure is
 * logged and isolated (it never fails the emitter). Subscribe with a concrete
 * type, a `prefix.*` pattern, or `*`.
 */
export class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  on(pattern: string, handler: EventHandler): void {
    const list = this.handlers.get(pattern) ?? [];
    list.push(handler);
    this.handlers.set(pattern, list);
  }

  private matching(type: string): EventHandler[] {
    const out: EventHandler[] = [];
    for (const [pattern, list] of this.handlers) {
      if (pattern === '*' || pattern === type) out.push(...list);
      else if (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1))) out.push(...list);
    }
    return out;
  }

  async emit(event: PlatformEvent): Promise<void> {
    for (const handler of this.matching(event.type)) {
      try {
        await handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[event-bus] handler failed for ${event.type}:`, err);
      }
    }
  }
}

/**
 * Append-only, hash-chained event log — one JSONL file per tenant. This is the
 * system of record for the communication lifecycle (event sourcing) and the
 * tamper-evident audit trail (see platform/06, SEC-AUD controls).
 */
export class EventLog {
  private seqs = new Map<string, { seq: number; hash: string }>();

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(tenantId: string): string {
    return join(this.dir, `${tenantId}.events.jsonl`);
  }

  private head(tenantId: string): { seq: number; hash: string } {
    const cached = this.seqs.get(tenantId);
    if (cached) return cached;
    const last = this.readAll(tenantId).at(-1);
    const head = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: 'genesis' };
    this.seqs.set(tenantId, head);
    return head;
  }

  append(event: PlatformEvent): StoredEvent {
    const head = this.head(event.tenantid);
    const seq = head.seq + 1;
    const prevhash = head.hash;
    const hash = createHash('sha256')
      .update(prevhash + JSON.stringify(event))
      .digest('hex');
    const stored: StoredEvent = { ...event, seq, hash, prevhash };
    appendFileSync(this.file(event.tenantid), JSON.stringify(stored) + '\n');
    this.seqs.set(event.tenantid, { seq, hash });
    return stored;
  }

  readAll(tenantId: string): StoredEvent[] {
    const file = this.file(tenantId);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StoredEvent);
  }

  query(
    tenantId: string,
    filter: { type?: string; typePrefix?: string; subject?: string; limit?: number } = {},
  ): StoredEvent[] {
    let events = this.readAll(tenantId);
    if (filter.type) events = events.filter((e) => e.type === filter.type);
    if (filter.typePrefix) events = events.filter((e) => e.type.startsWith(filter.typePrefix!));
    if (filter.subject) events = events.filter((e) => e.subject === filter.subject);
    if (filter.limit && events.length > filter.limit) events = events.slice(-filter.limit);
    return events;
  }

  /** Recomputes the hash chain; returns first broken sequence number, or null if intact. */
  verifyChain(tenantId: string): { intact: boolean; brokenAtSeq: number | null; length: number } {
    const events = this.readAll(tenantId);
    let prev = 'genesis';
    for (const stored of events) {
      const { seq, hash, prevhash, ...event } = stored;
      const expected = createHash('sha256')
        .update(prev + JSON.stringify(event))
        .digest('hex');
      if (prevhash !== prev || hash !== expected) {
        return { intact: false, brokenAtSeq: seq, length: events.length };
      }
      prev = hash;
    }
    return { intact: true, brokenAtSeq: null, length: events.length };
  }
}
