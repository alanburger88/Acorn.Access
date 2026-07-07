/**
 * SQLite storage adapter for the kernel StorePort.
 *
 * Production mapping is Postgres per platform/04 ("store per purpose" ADR);
 * this adapter proves the port against a real SQL engine with zero external
 * dependencies (node:sqlite ships with the Node 22 runtime). Behaviorally
 * identical to the file-backed Collection reference implementation in
 * src/kernel/storage.ts: documents round-trip through JSON.stringify/parse,
 * filters run in JS, and tenant scoping matches getFor/list semantics.
 */
import type { StatementSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CollectionPort, StorePort } from '../kernel/storage.js';

// Loaded via createRequire rather than a static import: the vite-based test
// runner does not yet know `node:sqlite` as a builtin, while a runtime
// require of a node: builtin works everywhere this code runs.
const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');

interface PreparedCollection {
  get: StatementSync;
  getFor: StatementSync;
  put: StatementSync;
  del: StatementSync;
  list: StatementSync;
  listAll: StatementSync;
}

class SqliteCollection<T extends { id: string; tenantId: string }> implements CollectionPort<T> {
  constructor(private stmts: PreparedCollection) {}

  private parse(row: unknown): T {
    return JSON.parse((row as { doc: string }).doc) as T;
  }

  get(id: string): T | undefined {
    const row = this.stmts.get.get(id);
    return row === undefined ? undefined : this.parse(row);
  }

  getFor(tenantId: string, id: string): T | undefined {
    const row = this.stmts.getFor.get(id, tenantId);
    return row === undefined ? undefined : this.parse(row);
  }

  put(doc: T): T {
    this.stmts.put.run(doc.id, doc.tenantId, JSON.stringify(doc));
    return doc;
  }

  delete(id: string): boolean {
    return this.stmts.del.run(id).changes > 0;
  }

  list(tenantId: string, filter?: (doc: T) => boolean): T[] {
    const out: T[] = [];
    for (const row of this.stmts.list.all(tenantId)) {
      const doc = this.parse(row);
      if (!filter || filter(doc)) out.push(doc);
    }
    return out;
  }

  listAll(filter?: (doc: T) => boolean): T[] {
    const out: T[] = [];
    for (const row of this.stmts.listAll.all()) {
      const doc = this.parse(row);
      if (!filter || filter(doc)) out.push(doc);
    }
    return out;
  }
}

/** Collection names are code-controlled; this guard rejects anything unusual. */
function sanitizeName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`invalid collection name: ${JSON.stringify(name)} (allowed: [a-zA-Z0-9_])`);
  }
  return name;
}

export function createSqliteStore(dbFile: string): StorePort & { close(): void } {
  mkdirSync(dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');

  const collections = new Map<string, SqliteCollection<never>>();

  return {
    collection<T extends { id: string; tenantId: string }>(name: string): CollectionPort<T> {
      let col = collections.get(name);
      if (!col) {
        const safe = sanitizeName(name);
        const table = `col_${safe}`;
        db.exec(
          `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc TEXT NOT NULL)`,
        );
        db.exec(`CREATE INDEX IF NOT EXISTS idx_${safe}_tenant ON ${table}(tenant_id)`);
        const stmts: PreparedCollection = {
          get: db.prepare(`SELECT doc FROM ${table} WHERE id = ?`),
          getFor: db.prepare(`SELECT doc FROM ${table} WHERE id = ? AND tenant_id = ?`),
          put: db.prepare(
            `INSERT INTO ${table} (id, tenant_id, doc) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET tenant_id = excluded.tenant_id, doc = excluded.doc`,
          ),
          del: db.prepare(`DELETE FROM ${table} WHERE id = ?`),
          list: db.prepare(`SELECT doc FROM ${table} WHERE tenant_id = ?`),
          listAll: db.prepare(`SELECT doc FROM ${table}`),
        };
        col = new SqliteCollection(stmts) as SqliteCollection<never>;
        collections.set(name, col);
      }
      return col as unknown as CollectionPort<T>;
    },
    close(): void {
      db.close();
    },
  };
}
