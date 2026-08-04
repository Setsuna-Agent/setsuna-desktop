import type { DatabaseSync } from 'node:sqlite';
import { buildThreadSearchPreview } from './thread-search.js';

type SearchRow = Record<string, string | number | bigint | Uint8Array | null>;

export function searchSqliteThreadMessagePreviews(
  database: DatabaseSync,
  search: string,
): Map<string, string> {
  const rows = database.prepare(`
    SELECT messages.thread_id,
           json_extract(messages.message_json, '$.content') AS message_content
    FROM thread_messages AS messages
    INNER JOIN (
      SELECT thread_id, MAX(message_index) AS message_index
      FROM thread_messages
      WHERE instr(lower(CAST(json_extract(message_json, '$.content') AS TEXT)), ?) > 0
      GROUP BY thread_id
    ) AS matches
      ON matches.thread_id = messages.thread_id
     AND matches.message_index = messages.message_index
  `).all(search) as SearchRow[];
  const previews = new Map<string, string>();
  for (const row of rows) {
    const preview = buildThreadSearchPreview(
      requiredText(row, 'message_content'),
      search,
    );
    if (preview) previews.set(requiredText(row, 'thread_id'), preview);
  }
  return previews;
}

function requiredText(row: SearchRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`Invalid SQLite ${column} column.`);
  return value;
}
