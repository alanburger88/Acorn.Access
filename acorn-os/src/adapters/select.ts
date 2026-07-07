/** Env-driven storage driver selection, shared by the server and CLI entrypoints. */
import { join } from 'node:path';
import type { PlatformConfig } from '../kernel/context.js';
import type { ObjectStorePort, StorePort } from '../kernel/storage.js';
import { createSqliteStore } from './sqlite-store.js';

export function adaptersFromEnv(
  config: PlatformConfig,
): { store?: StorePort; objects?: ObjectStorePort } {
  // ACORN_STORE=sqlite swaps the file-backed collections for the SQL adapter
  // (same StorePort; domains are untouched).
  if (process.env.ACORN_STORE === 'sqlite') {
    return { store: createSqliteStore(join(config.dataDir, 'acorn.sqlite')) };
  }
  return {};
}
