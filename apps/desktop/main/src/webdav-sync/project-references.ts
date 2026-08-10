import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';

type SqliteRow = Record<string, string | number | bigint | Uint8Array | null>;

export async function remapStagedProjectReferences(input: {
  stagingRoot: string;
  projectIdMap: ReadonlyMap<string, string>;
  targetPaths: ReadonlyMap<string, string>;
  conversations: boolean;
  memories: boolean;
}): Promise<void> {
  if (!input.projectIdMap.size) return;
  if (input.conversations) {
    const databasePath = path.join(input.stagingRoot, 'runtime', 'threads.sqlite');
    if (await isRegularFile(databasePath)) {
      remapConversationDatabase(databasePath, input.projectIdMap, input.targetPaths);
    }
  }
  if (input.memories) {
    const memoriesPath = path.join(input.stagingRoot, 'runtime', 'memories', 'memories.json');
    if (await isRegularFile(memoriesPath)) {
      await remapMemoryIndex(memoriesPath, input.projectIdMap, input.targetPaths);
    }
  }
}

function remapConversationDatabase(
  databasePath: string,
  projectIdMap: ReadonlyMap<string, string>,
  targetPaths: ReadonlyMap<string, string>,
): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      const updateThread = database.prepare(`
        UPDATE threads SET project_id = ?, snapshot_json = ? WHERE id = ?
      `);
      for (const row of database.prepare(`
        SELECT id, project_id, snapshot_json FROM threads WHERE project_id IS NOT NULL
      `).all() as SqliteRow[]) {
        const sourceProjectId = stringColumn(row, 'project_id');
        const targetProjectId = projectIdMap.get(sourceProjectId);
        if (!targetProjectId) continue;
        const snapshot = parseJsonColumn(row, 'snapshot_json', `thread ${stringColumn(row, 'id')}`);
        const remapped = remapStructuredValue(snapshot, projectIdMap, targetPaths);
        updateThread.run(targetProjectId, JSON.stringify(remapped.value), stringColumn(row, 'id'));
      }

      const updateMessage = database.prepare(`
        UPDATE thread_messages SET message_json = ? WHERE thread_id = ? AND message_index = ?
      `);
      for (const row of database.prepare(`
        SELECT thread_id, message_index, message_json FROM thread_messages
      `).all() as SqliteRow[]) {
        const message = parseJsonColumn(
          row,
          'message_json',
          `message ${stringColumn(row, 'thread_id')}:${numberColumn(row, 'message_index')}`,
        );
        const remapped = remapStructuredValue(message, projectIdMap, targetPaths);
        if (!remapped.changed) continue;
        updateMessage.run(
          JSON.stringify(remapped.value),
          stringColumn(row, 'thread_id'),
          numberColumn(row, 'message_index'),
        );
      }
      if (sqliteTableExists(database, 'runtime_events')) {
        remapRuntimeEvents(database, projectIdMap, targetPaths);
      }
      if (sqliteTableExists(database, 'runtime_event_archives')) {
        remapRuntimeEventArchives(database, projectIdMap, targetPaths);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

function remapRuntimeEvents(
  database: DatabaseSync,
  projectIdMap: ReadonlyMap<string, string>,
  targetPaths: ReadonlyMap<string, string>,
): void {
  const updateEvent = database.prepare(`
    UPDATE runtime_events SET event_json = ? WHERE thread_id = ? AND seq = ?
  `);
  for (const row of database.prepare(`
    SELECT thread_id, seq, event_json FROM runtime_events
  `).all() as SqliteRow[]) {
    const threadId = stringColumn(row, 'thread_id');
    const seq = numberColumn(row, 'seq');
    const event = parseJsonColumn(row, 'event_json', `event ${threadId}:${seq}`);
    const remapped = remapStructuredValue(event, projectIdMap, targetPaths);
    if (remapped.changed) updateEvent.run(JSON.stringify(remapped.value), threadId, seq);
  }
}

function remapRuntimeEventArchives(
  database: DatabaseSync,
  projectIdMap: ReadonlyMap<string, string>,
  targetPaths: ReadonlyMap<string, string>,
): void {
  const updateArchive = database.prepare(`
    UPDATE runtime_event_archives SET events_gzip = ? WHERE thread_id = ? AND start_seq = ?
  `);
  for (const row of database.prepare(`
    SELECT thread_id, start_seq, events_gzip FROM runtime_event_archives
  `).all() as SqliteRow[]) {
    const threadId = stringColumn(row, 'thread_id');
    const startSeq = numberColumn(row, 'start_seq');
    let events: unknown;
    try {
      events = JSON.parse(gunzipSync(blobColumn(row, 'events_gzip')).toString('utf8')) as unknown;
    } catch (error) {
      throw new Error(`备份数据库中的事件归档 ${threadId}:${startSeq} 无效。`, { cause: error });
    }
    if (!Array.isArray(events)) {
      throw new Error(`备份数据库中的事件归档 ${threadId}:${startSeq} 无效。`);
    }
    const remapped = remapStructuredValue(events, projectIdMap, targetPaths);
    if (remapped.changed) {
      updateArchive.run(gzipSync(JSON.stringify(remapped.value)), threadId, startSeq);
    }
  }
}

async function remapMemoryIndex(
  memoryPath: string,
  projectIdMap: ReadonlyMap<string, string>,
  targetPaths: ReadonlyMap<string, string>,
): Promise<void> {
  const data = await readFile(memoryPath, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch (error) {
    throw new Error('备份中的记忆索引不是有效 JSON。', { cause: error });
  }
  const remapped = remapStructuredValue(value, projectIdMap, targetPaths);
  if (remapped.changed) {
    await writeFile(memoryPath, `${JSON.stringify(remapped.value, null, 2)}\n`, 'utf8');
  }
}

function remapStructuredValue(
  value: unknown,
  projectIdMap: ReadonlyMap<string, string>,
  targetPaths: ReadonlyMap<string, string>,
): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const remapped = remapStructuredValue(item, projectIdMap, targetPaths);
      changed ||= remapped.changed;
      return remapped.value;
    });
    return changed ? { value: items, changed: true } : { value, changed: false };
  }
  if (!isRecord(value)) return { value, changed: false };

  let changed = false;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const remapped = remapStructuredValue(item, projectIdMap, targetPaths);
    changed ||= remapped.changed;
    output[key] = remapped.value;
  }
  const sourceProjectId = typeof value.projectId === 'string' ? value.projectId : undefined;
  const sourceEnvironmentId = typeof value.environmentId === 'string'
    ? value.environmentId
    : undefined;
  const sourceToolEnvironmentId = typeof value.id === 'string' && isToolEnvironment(value)
    ? value.id
    : undefined;
  const sourceWorkspaceProjectId = typeof value.workspaceProjectId === 'string'
    ? value.workspaceProjectId
    : undefined;
  const mappedProjectId = sourceProjectId ? projectIdMap.get(sourceProjectId) : undefined;
  const mappedEnvironmentId = sourceEnvironmentId ? projectIdMap.get(sourceEnvironmentId) : undefined;
  const mappedToolEnvironmentId = sourceToolEnvironmentId
    ? projectIdMap.get(sourceToolEnvironmentId)
    : undefined;
  const mappedWorkspaceProjectId = sourceWorkspaceProjectId
    ? projectIdMap.get(sourceWorkspaceProjectId)
    : undefined;
  if (mappedProjectId) {
    output.projectId = mappedProjectId;
    changed ||= mappedProjectId !== sourceProjectId;
  }
  if (mappedEnvironmentId) {
    output.environmentId = mappedEnvironmentId;
    changed ||= mappedEnvironmentId !== sourceEnvironmentId;
  }
  if (mappedToolEnvironmentId) {
    output.id = mappedToolEnvironmentId;
    changed ||= mappedToolEnvironmentId !== sourceToolEnvironmentId;
  }
  const targetProjectId = mappedProjectId ?? mappedEnvironmentId ?? mappedToolEnvironmentId;
  if (mappedWorkspaceProjectId) {
    output.workspaceProjectId = mappedWorkspaceProjectId;
    changed ||= mappedWorkspaceProjectId !== sourceWorkspaceProjectId;
  } else if (sourceWorkspaceProjectId && targetProjectId) {
    // Managed workspace IDs are device-local. If they are not part of the
    // portable project map, let the target device allocate a fresh one.
    delete output.workspaceProjectId;
    changed = true;
  }
  if (targetProjectId) {
    const targetPath = targetPaths.get(targetProjectId);
    for (const key of ['workspaceRoot', 'cwd'] as const) {
      if (!Object.hasOwn(value, key)) continue;
      if (targetPath) output[key] = targetPath;
      else delete output[key];
      changed = true;
    }
    if (Object.hasOwn(value, 'workspaceRoots')) {
      if (targetPath) output.workspaceRoots = [targetPath];
      else delete output.workspaceRoots;
      changed = true;
    }
    if (sourceToolEnvironmentId && Object.hasOwn(value, 'repository')) {
      delete output.repository;
      changed = true;
    }
  }
  return changed ? { value: output, changed: true } : { value, changed: false };
}

function isToolEnvironment(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, 'cwd')
    || Object.hasOwn(value, 'workspaceRoot')
    || Object.hasOwn(value, 'workspaceRoots');
}

function parseJsonColumn(row: SqliteRow, column: string, label: string): unknown {
  try {
    return JSON.parse(stringColumn(row, column)) as unknown;
  } catch (error) {
    throw new Error(`备份数据库中的 ${label} 数据无效。`, { cause: error });
  }
}

function stringColumn(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`备份数据库字段 ${column} 无效。`);
  return value;
}

function numberColumn(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`备份数据库字段 ${column} 无效。`);
}

function blobColumn(row: SqliteRow, column: string): Uint8Array {
  const value = row[column];
  if (!(value instanceof Uint8Array)) throw new Error(`备份数据库字段 ${column} 无效。`);
  return value;
}

function sqliteTableExists(database: DatabaseSync, tableName: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName));
}

async function isRegularFile(filePath: string): Promise<boolean> {
  return lstat(filePath).then((value) => value.isFile()).catch((error) => {
    if (isMissingFileError(error)) return false;
    throw error;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
