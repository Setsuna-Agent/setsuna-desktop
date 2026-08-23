import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { DataMigrationManifest } from './model.js';
import { desktopDataLayout } from './layout.js';

const MANAGED_JSON_PATHS = new Set([
  '.setsuna-data-root.json',
  'network-proxies.json',
  'secure-credentials.json',
  'update-download-sources.json',
  'webdav-sync.json',
  '.webdav-sync-restore.json',
  'window-preferences.json',
  'window-state.json',
  'runtime/.setsuna-legacy-data-import.json',
  'runtime/attachments/index.json',
  'runtime/config.json',
  'runtime/mcp.json',
  'runtime/memories/.setsuna-memory-legacy-import.json',
  'runtime/memories/.setsuna-memory-root.json',
  'runtime/memories/.setsuna-phase2-baseline.json',
  'runtime/memories/memories.json',
  'runtime/pc-local-policies/legacy-exec-policy.json',
  'runtime/pc-local-policies/legacy-shell-policy.json',
  'runtime/plugins.json',
  'runtime/policy-amendments.json',
  'runtime/projects.json',
  'runtime/secrets.json',
  'runtime/skills.json',
  'runtime/threads/index.json',
  'runtime/tool-approvals.json',
  'runtime/workspace-dependencies/manifest.json',
]);
const MANAGED_JSONL_PATHS = new Set(['runtime/usage.jsonl']);
const RUNTIME_OWNERSHIP_RELEASE_TIMEOUT_MS = 20_000;
const RUNTIME_OWNERSHIP_POLL_INTERVAL_MS = 250;

/**
 * A crashed runtime can leave its fenced ownership row behind until the 15-second
 * lease expires. Once expired, remove that process-only row atomically so the old
 * owner is fenced before scanning; a live orphan that renews it still blocks migration.
 */
export async function waitForRuntimeOwnershipRelease(dataRoot: string): Promise<void> {
  const databasePath = desktopDataLayout(dataRoot).runtimeDatabasePath;
  const databaseStats = await stat(databasePath).catch(() => null);
  if (!databaseStats?.isFile()) return;

  const sqlite = requireSqlite();
  const deadline = Date.now() + RUNTIME_OWNERSHIP_RELEASE_TIMEOUT_MS;
  for (;;) {
    const database = new sqlite.DatabaseSync(databasePath);
    let leaseExpiresAt: number | null;
    try {
      leaseExpiresAt = runtimeOwnershipLeaseExpiresAt(database);
      const now = Date.now();
      if (leaseExpiresAt !== null && leaseExpiresAt <= now) {
        const removed = database.prepare(`
          DELETE FROM runtime_owner
          WHERE slot = 1 AND lease_expires_at = ?
        `).run(leaseExpiresAt);
        if (Number(removed.changes) === 1) {
          database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
          return;
        }
        leaseExpiresAt = runtimeOwnershipLeaseExpiresAt(database);
      }
    } finally {
      database.close();
    }

    const now = Date.now();
    if (leaseExpiresAt === null) return;
    const remainingWaitMs = deadline - now;
    if (remainingWaitMs <= 0) {
      throw new Error('SQLite runtime ownership lease is still active.');
    }
    await delay(Math.min(
      RUNTIME_OWNERSHIP_POLL_INTERVAL_MS,
      remainingWaitMs,
      Math.max(1, leaseExpiresAt - now + 1),
    ));
  }
}

export async function validateCopiedManifest(
  stagingRoot: string,
  manifest: DataMigrationManifest,
  sourceHashes: ReadonlyMap<string, string>,
): Promise<void> {
  for (const entry of manifest.entries) {
    const targetPath = path.join(stagingRoot, entry.relativePath);
    const stats = await lstat(targetPath);
    if (entry.kind === 'symlink') {
      if (
        !stats.isSymbolicLink()
        || await readlink(targetPath) !== entry.linkTarget
        || await readlink(entry.absolutePath) !== (entry.sourceLinkTarget ?? entry.linkTarget)
      ) {
        throw new Error(`Symlink validation failed: ${entry.relativePath}`);
      }
      continue;
    }
    if (!stats.isFile() || stats.size !== entry.size) {
      throw new Error(`File size validation failed: ${entry.relativePath}`);
    }
    const sourceHash = sourceHashes.get(entry.relativePath);
    const currentSourceStats = await lstat(entry.absolutePath);
    if (
      !sourceHash
      || !currentSourceStats.isFile()
      || currentSourceStats.size !== entry.size
      || currentSourceStats.mtimeMs !== entry.mtimeMs
      || await sha256File(entry.absolutePath) !== sourceHash
      || await sha256File(targetPath) !== sourceHash
    ) {
      throw new Error(`File checksum validation failed: ${entry.relativePath}`);
    }
  }
}

export async function validateMigratedData(
  sourceRoot: string,
  stagingRoot: string,
  manifest: DataMigrationManifest,
): Promise<void> {
  await validateJsonFiles(stagingRoot, manifest);
  await validateSqliteDatabase(
    desktopDataLayout(sourceRoot).runtimeDatabasePath,
    desktopDataLayout(stagingRoot).runtimeDatabasePath,
  );
  await validateAttachmentIndex(stagingRoot);
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function validateJsonFiles(
  stagingRoot: string,
  manifest: DataMigrationManifest,
): Promise<void> {
  for (const entry of manifest.entries) {
    if (entry.kind !== 'file') continue;
    const targetPath = path.join(stagingRoot, entry.relativePath);
    const validationKind = structuredValidationKind(entry.relativePath);
    if (validationKind === 'json') {
      try {
        JSON.parse(await readFile(targetPath, 'utf8'));
      } catch (error) {
        throw new Error(`JSON validation failed: ${entry.relativePath}`, { cause: error });
      }
    }
    if (validationKind === 'jsonl') {
      const lines = (await readFile(targetPath, 'utf8')).split(/\r?\n/u);
      for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        try {
          JSON.parse(line);
        } catch (error) {
          throw new Error(
            `JSONL validation failed: ${entry.relativePath}:${index + 1}`,
            { cause: error },
          );
        }
      }
    }
  }
}

function structuredValidationKind(relativePath: string): 'json' | 'jsonl' | undefined {
  const normalized = relativePath.split(path.sep).join('/');
  if (MANAGED_JSON_PATHS.has(normalized)) return 'json';
  if (MANAGED_JSONL_PATHS.has(normalized)) return 'jsonl';
  if (/^runtime\/threads\/[^/]+\.json$/u.test(normalized)) return 'json';
  if (/^runtime\/threads\/[^/]+\.jsonl$/u.test(normalized)) return 'jsonl';
  return undefined;
}

async function validateSqliteDatabase(sourcePath: string, targetPath: string): Promise<void> {
  const targetStats = await stat(targetPath).catch(() => null);
  if (!targetStats?.isFile()) return;
  const sqlite = requireSqlite();
  const source = new sqlite.DatabaseSync(sourcePath, { readOnly: true });
  const target = new sqlite.DatabaseSync(targetPath, { readOnly: true });
  try {
    const quickCheck = target.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>;
    if (quickCheck.length !== 1 || Object.values(quickCheck[0] ?? {})[0] !== 'ok') {
      throw new Error('SQLite quick_check failed.');
    }
    const foreignKeyErrors = target.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyErrors.length) throw new Error('SQLite foreign_key_check failed.');
    const leaseExpiresAt = runtimeOwnershipLeaseExpiresAt(target);
    if (leaseExpiresAt !== null && leaseExpiresAt > Date.now()) {
      throw new Error('SQLite runtime ownership lease is still active.');
    }
    for (const table of ['threads', 'runtime_events', 'store_metadata']) {
      const sourceCount = tableCount(source, table);
      const targetCount = tableCount(target, table);
      if (sourceCount !== targetCount) {
        throw new Error(`SQLite ${table} count changed during migration.`);
      }
    }
  } finally {
    source.close();
    target.close();
  }
}

function requireSqlite(): typeof import('node:sqlite') {
  const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined;
  if (!sqlite) throw new Error('SQLite validation is unavailable in this runtime.');
  return sqlite;
}

function runtimeOwnershipLeaseExpiresAt(
  database: import('node:sqlite').DatabaseSync,
): number | null {
  const table = database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'runtime_owner'",
  ).get();
  if (!table) return null;
  const row = database.prepare(
    'SELECT lease_expires_at FROM runtime_owner WHERE slot = 1',
  ).get() as { lease_expires_at?: number | bigint } | undefined;
  if (!row) return null;
  const leaseExpiresAt = Number(row.lease_expires_at);
  if (!Number.isFinite(leaseExpiresAt)) {
    throw new Error('SQLite runtime ownership lease is invalid.');
  }
  return leaseExpiresAt;
}

function tableCount(
  database: import('node:sqlite').DatabaseSync,
  table: string,
): number {
  const exists = database.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { count?: number | bigint } | undefined;
  if (Number(exists?.count ?? 0) === 0) return 0;
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count?: number | bigint;
  } | undefined;
  return Number(row?.count ?? 0);
}

async function validateAttachmentIndex(stagingRoot: string): Promise<void> {
  const runtimeRoot = desktopDataLayout(stagingRoot).runtimeRoot;
  const indexPath = path.join(runtimeRoot, 'attachments', 'index.json');
  const raw = await readFile(indexPath, 'utf8').catch(() => null);
  if (!raw) return;
  const index = JSON.parse(raw) as { attachments?: unknown[] };
  if (index.attachments !== undefined && !Array.isArray(index.attachments)) {
    throw new Error('Attachment index validation failed.');
  }
}
