/**
 * Backup / restore / verify tool for the Acorn data directory.
 *
 *   npx tsx src/tools/backup.ts backup  <archive.tgz>              # dataDir -> tgz
 *   npx tsx src/tools/backup.ts restore <archive.tgz> [targetDir]  # tgz -> EMPTY dir
 *   npx tsx src/tools/backup.ts verify  [archive.tgz | dataDir]    # event-chain check
 *
 * The data dir comes from ACORN_DATA_DIR (default ./data). The archive is a
 * gzipped ustar tarball written by the minimal tar implementation below
 * (files only, 512-byte blocks) with a leading `manifest.json` entry
 * describing the backup (fileCount, totalBytes, createdAt, sha256 of the
 * concatenated per-file hashes).
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { EventLog } from '../kernel/events.js';

const BLOCK = 512;

export interface BackupManifest {
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  /** sha256 over the concatenation of every file's own sha256 (hex), in archive order */
  sha256: string;
}

// ---------------------------------------------------------------------------
// Minimal ustar writer/reader (files only)
// ---------------------------------------------------------------------------

/** All regular files under dir as sorted '/'-separated relative paths. */
function walk(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  header.write(value.toString(8).padStart(length - 1, '0'), offset, 'ascii'); // NUL-terminated
}

function tarHeader(name: string, size: number, mtimeSec: number): Buffer {
  const header = Buffer.alloc(BLOCK, 0);
  // ustar name/prefix split for paths over 100 chars.
  let file = name;
  let prefix = '';
  if (file.length > 100) {
    const idx = name.indexOf('/', Math.max(0, name.length - 101));
    if (idx === -1 || idx > 155) throw new Error(`path too long for ustar: ${name}`);
    prefix = name.slice(0, idx);
    file = name.slice(idx + 1);
  }
  header.write(file, 0, 100, 'utf8');
  writeOctal(header, 100, 8, 0o644); // mode
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtimeSec);
  header.fill(0x20, 148, 156); // chksum = spaces while summing
  header.write('0', 156, 'ascii'); // typeflag: regular file
  header.write('ustar', 257, 'ascii'); // magic (+ implicit NUL at 262)
  header.write('00', 263, 'ascii'); // version
  header.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return header;
}

function readString(buf: Buffer, start: number, length: number): string {
  const raw = buf.toString('utf8', start, start + length);
  const nul = raw.indexOf('\0');
  return nul === -1 ? raw : raw.slice(0, nul);
}

interface TarEntry {
  name: string;
  data: Buffer;
}

function* readTar(tar: Buffer): Generator<TarEntry> {
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) return; // end-of-archive marker
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = parseInt(readString(header, 124, 12).trim() || '0', 8);
    const typeflag = header[156];
    const data = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    // Files only ('0' or NUL typeflag); this writer emits nothing else.
    if (typeflag === 0x30 || typeflag === 0) {
      yield { name: prefix ? `${prefix}/${name}` : name, data: Buffer.from(data) };
    }
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function backup(dataDir: string, archivePath: string): BackupManifest {
  if (!existsSync(dataDir)) throw new Error(`data dir not found: ${dataDir}`);
  const files = walk(dataDir);
  const combined = createHash('sha256');
  let totalBytes = 0;
  const entries: TarEntry[] = [];
  for (const name of files) {
    const data = readFileSync(join(dataDir, name));
    totalBytes += data.length;
    combined.update(createHash('sha256').update(data).digest('hex'));
    entries.push({ name, data });
  }
  const manifest: BackupManifest = {
    fileCount: files.length,
    totalBytes,
    createdAt: new Date().toISOString(),
    sha256: combined.digest('hex'),
  };

  const mtime = Math.floor(Date.now() / 1000);
  const blocks: Buffer[] = [];
  const push = (name: string, data: Buffer) => {
    blocks.push(tarHeader(name, data.length, mtime), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) blocks.push(Buffer.alloc(pad, 0));
  };
  push('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  for (const entry of entries) push(entry.name, entry.data);
  blocks.push(Buffer.alloc(BLOCK * 2, 0)); // end-of-archive

  mkdirSync(dirname(resolve(archivePath)), { recursive: true });
  writeFileSync(archivePath, gzipSync(Buffer.concat(blocks)));
  return manifest;
}

export function restore(
  archivePath: string,
  targetDir: string,
): { fileCount: number; manifest?: BackupManifest } {
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    throw new Error(`refusing to restore into non-empty directory: ${targetDir}`);
  }
  mkdirSync(targetDir, { recursive: true });
  const root = resolve(targetDir);
  const tar = gunzipSync(readFileSync(archivePath));
  let fileCount = 0;
  let manifest: BackupManifest | undefined;
  for (const entry of readTar(tar)) {
    if (entry.name === 'manifest.json') {
      manifest = JSON.parse(entry.data.toString('utf8')) as BackupManifest;
      continue; // archive metadata, not data-dir content
    }
    const dest = resolve(root, entry.name);
    if (dest !== root && !dest.startsWith(root + sep)) {
      throw new Error(`archive entry escapes target dir: ${entry.name}`);
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entry.data);
    fileCount++;
  }
  if (manifest && manifest.fileCount !== fileCount) {
    throw new Error(`manifest expects ${manifest.fileCount} files, extracted ${fileCount}`);
  }
  return { fileCount, manifest };
}

export interface VerifyResult {
  ok: boolean;
  tenants: { tenantId: string; intact: boolean; brokenAtSeq: number | null; length: number }[];
}

/** Verify every tenant event chain in a live dataDir, or inside a .tgz backup. */
export function verify(dataDirOrArchive: string): VerifyResult {
  let dataDir = dataDirOrArchive;
  if (dataDirOrArchive.endsWith('.tgz') || dataDirOrArchive.endsWith('.tar.gz')) {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-verify-'));
    restore(dataDirOrArchive, dataDir);
  }
  const eventsDir = join(dataDir, 'events');
  const tenants: VerifyResult['tenants'] = [];
  if (existsSync(eventsDir)) {
    const log = new EventLog(eventsDir);
    const suffix = '.events.jsonl';
    for (const file of readdirSync(eventsDir)
      .filter((f) => f.endsWith(suffix))
      .sort()) {
      const tenantId = file.slice(0, -suffix.length);
      tenants.push({ tenantId, ...log.verifyChain(tenantId) });
    }
  }
  return { ok: tenants.every((t) => t.intact), tenants };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(argv: string[] = process.argv.slice(2)): number {
  const [command, target, extra] = argv;
  const dataDir = process.env.ACORN_DATA_DIR ?? './data';

  if (command === 'backup' && target) {
    const manifest = backup(dataDir, target);
    console.log(
      `backup: ${dataDir} -> ${target} (${manifest.fileCount} files, ` +
        `${manifest.totalBytes} bytes, sha256 ${manifest.sha256})`,
    );
    return 0;
  }
  if (command === 'restore' && target) {
    const dest = extra ?? dataDir;
    const result = restore(target, dest);
    console.log(`restore: ${target} -> ${dest} (${result.fileCount} files)`);
    if (result.manifest) console.log(`restore: manifest created ${result.manifest.createdAt}`);
    return 0;
  }
  if (command === 'verify') {
    const result = verify(target ?? dataDir);
    if (result.tenants.length === 0) console.log('verify: no tenant event logs found');
    for (const t of result.tenants) {
      console.log(
        `verify: ${t.tenantId}: ` +
          (t.intact ? `intact (${t.length} events)` : `BROKEN at seq ${t.brokenAtSeq}`),
      );
    }
    console.log(result.ok ? 'verify: all chains intact' : 'verify: chain verification FAILED');
    return result.ok ? 0 : 1;
  }
  console.log('usage: npx tsx src/tools/backup.ts backup|restore|verify <archive.tgz> [targetDir]');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
