import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

function atomicWrite(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, contents);
  renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Storage ports — adapters (src/adapters/*) implement these so deployments can
// swap the file-backed reference store for SQL/object-storage backends without
// touching any domain (platform/04 "store per purpose" ADR).
// ---------------------------------------------------------------------------

export interface CollectionPort<T extends { id: string; tenantId: string }> {
  get(id: string): T | undefined;
  /** Get scoped to a tenant — undefined when the doc belongs to another tenant. */
  getFor(tenantId: string, id: string): T | undefined;
  put(doc: T): T;
  delete(id: string): boolean;
  list(tenantId: string, filter?: (doc: T) => boolean): T[];
  listAll(filter?: (doc: T) => boolean): T[];
}

export interface StorePort {
  collection<T extends { id: string; tenantId: string }>(name: string): CollectionPort<T>;
}

export interface ObjectStorePort {
  put(tenantId: string, buf: Buffer, contentType: string): StoredObject;
  get(key: string): { buf: Buffer; contentType: string } | undefined;
  listKeys(tenantId: string): string[];
}

/**
 * Durable document collection persisted as a single JSON file with atomic
 * writes. Suitable for the reference deployment; swap for Postgres via the
 * same interface in scaled deployments (see platform/04, ADR "store per
 * purpose"). All documents carry `id` and `tenantId`.
 */
export class Collection<T extends { id: string; tenantId: string }> implements CollectionPort<T> {
  private docs = new Map<string, T>();

  constructor(private file: string) {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as T[];
      for (const doc of raw) this.docs.set(doc.id, doc);
    }
  }

  private persist(): void {
    atomicWrite(this.file, JSON.stringify([...this.docs.values()], null, 1));
  }

  get(id: string): T | undefined {
    return this.docs.get(id);
  }

  /** Get scoped to a tenant — returns undefined when the doc belongs to another tenant. */
  getFor(tenantId: string, id: string): T | undefined {
    const doc = this.docs.get(id);
    return doc && doc.tenantId === tenantId ? doc : undefined;
  }

  put(doc: T): T {
    this.docs.set(doc.id, doc);
    this.persist();
    return doc;
  }

  delete(id: string): boolean {
    const had = this.docs.delete(id);
    if (had) this.persist();
    return had;
  }

  list(tenantId: string, filter?: (doc: T) => boolean): T[] {
    const out: T[] = [];
    for (const doc of this.docs.values()) {
      if (doc.tenantId !== tenantId) continue;
      if (filter && !filter(doc)) continue;
      out.push(doc);
    }
    return out;
  }

  listAll(filter?: (doc: T) => boolean): T[] {
    const out: T[] = [];
    for (const doc of this.docs.values()) if (!filter || filter(doc)) out.push(doc);
    return out;
  }
}

export class Store implements StorePort {
  private collections = new Map<string, Collection<never>>();

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  collection<T extends { id: string; tenantId: string }>(name: string): Collection<T> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Collection(join(this.dir, `${name}.json`)) as Collection<never>;
      this.collections.set(name, col);
    }
    return col as unknown as Collection<T>;
  }
}

export interface StoredObject {
  key: string;
  sha256: string;
  size: number;
  contentType: string;
}

/**
 * Content-addressed object store on the filesystem (rendered artifacts,
 * archives, ingestion payloads). Immutable by construction: the key embeds the
 * content hash, so a stored artifact can never be silently replaced.
 */
export class ObjectStore implements ObjectStorePort {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  put(tenantId: string, buf: Buffer, contentType: string): StoredObject {
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const key = `${tenantId}/${sha256}`;
    const file = join(this.dir, tenantId, sha256);
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, buf);
    }
    atomicWrite(`${file}.meta.json`, JSON.stringify({ contentType, size: buf.length }));
    return { key, sha256, size: buf.length, contentType };
  }

  get(key: string): { buf: Buffer; contentType: string } | undefined {
    const file = join(this.dir, key);
    if (!existsSync(file)) return undefined;
    const meta = existsSync(`${file}.meta.json`)
      ? (JSON.parse(readFileSync(`${file}.meta.json`, 'utf8')) as { contentType: string })
      : { contentType: 'application/octet-stream' };
    return { buf: readFileSync(file), contentType: meta.contentType };
  }

  listKeys(tenantId: string): string[] {
    const dir = join(this.dir, tenantId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => !name.endsWith('.meta.json'))
      .map((name) => `${tenantId}/${name}`);
  }
}
