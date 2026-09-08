import type {
  FeatureProjectionCheckpoint,
  FeatureProjectionCheckpoints,
} from '@setsuna-desktop/feature-core/runtime';
import type { DatabaseSync } from 'node:sqlite';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';
import { numberColumn, stringColumn } from './sqlite-thread-row.js';

/** Shares the ThreadStore connection and lease, including its thread-delete cascade. */
export class SqliteFeatureProjectionCheckpoints implements FeatureProjectionCheckpoints {
  constructor(private readonly withDatabase: <T>(operation: (database: DatabaseSync) => T) => Promise<T>) {}

  read(threadId: string, key: string): Promise<FeatureProjectionCheckpoint | null> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    return this.withDatabase((database) => {
      const row = database.prepare(`
        SELECT through_seq, state_json FROM feature_projection_checkpoints
        WHERE thread_id = ? AND projection_key = ?
      `).get(safeThreadId, key);
      if (!row) return null;
      try {
        return { throughSeq: numberColumn(row, 'through_seq'), state: JSON.parse(stringColumn(row, 'state_json')) };
      } catch {
        return null;
      }
    });
  }

  write(threadId: string, key: string, checkpoint: FeatureProjectionCheckpoint): Promise<void> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    const stateJson = JSON.stringify(checkpoint.state);
    return this.withDatabase((database) => {
      // A concurrent thread deletion must not recreate cached data. Replay always writes
      // one complete fixed-watermark state; interrupted replay never advances this row.
      database.prepare(`
        INSERT INTO feature_projection_checkpoints(thread_id, projection_key, through_seq, state_json)
        SELECT id, ?, ?, ? FROM threads WHERE id = ? AND last_seq >= ?
        ON CONFLICT(thread_id, projection_key) DO UPDATE SET
          through_seq = excluded.through_seq, state_json = excluded.state_json
      `).run(key, checkpoint.throughSeq, stateJson, safeThreadId, checkpoint.throughSeq);
    });
  }
}
