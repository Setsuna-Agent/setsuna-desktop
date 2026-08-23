import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import type { StatementResultingChanges } from 'node:sqlite';
import { normalizeThreadMemoryMode } from './thread-store-state.js';

type SqliteThreadRow = Record<string, string | number | bigint | Uint8Array | null>;

/** Decode SQLite driver values at the persistence boundary before they reach domain state. */
export function summaryFromRow(row: SqliteThreadRow): RuntimeThreadSummary {
  return {
    id: stringColumn(row, 'id'),
    ...(stringColumn(row, 'kind') === 'side' ? { kind: 'side' as const } : {}),
    activeTurnId: nullableStringColumn(row, 'active_turn_id'),
    forkedFromId: nullableStringColumn(row, 'forked_from_id'),
    parentThreadId: nullableStringColumn(row, 'parent_thread_id'),
    projectId: nullableStringColumn(row, 'project_id'),
    title: stringColumn(row, 'title'),
    createdAt: stringColumn(row, 'created_at'),
    updatedAt: stringColumn(row, 'updated_at'),
    archived: numberColumn(row, 'archived') === 1,
    memoryMode: normalizeThreadMemoryMode(stringColumn(row, 'memory_mode')),
    gitInfo: parseOptionalJson(row, 'git_info_json'),
    messageCount: numberColumn(row, 'message_count'),
    lastMessagePreview: stringColumn(row, 'last_message_preview'),
  } as RuntimeThreadSummary;
}

export function optionalJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function stringColumn(row: SqliteThreadRow | undefined, column: string): string {
  const value = row?.[column];
  if (typeof value !== 'string') throw new Error(`Invalid SQLite text column: ${column}`);
  return value;
}

export function numberColumn(row: SqliteThreadRow | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid SQLite number column: ${column}`);
  }
  return value;
}

export function changedRows(result: StatementResultingChanges): number {
  return typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
}

function parseOptionalJson(row: SqliteThreadRow, column: string): unknown {
  const value = nullableStringColumn(row, column);
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Invalid SQLite JSON column: ${column}`, { cause: error });
  }
}

function nullableStringColumn(row: SqliteThreadRow, column: string): string | undefined {
  const value = row[column];
  if (value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid SQLite nullable text column: ${column}`);
  return value;
}
