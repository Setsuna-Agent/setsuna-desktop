import type { RuntimeThread, RuntimeThreadTurn, StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeSqliteJson, encodeSqliteJson } from './json.js';

type TurnCheckpoint = { turn: RuntimeThreadTurn; stepCount?: number };

/** The checkpoint header contains small thread state; ordered messages and turns live in rows. */
export function threadCheckpointHeader(thread: RuntimeThread): string {
  return JSON.stringify({
    thread: { ...thread, messages: [], turns: thread.turns ? [] : undefined },
    messageCount: thread.messages.length,
    turnCount: thread.turns?.length ?? 0,
  });
}

export function readThreadCheckpoint(
  database: DatabaseSync,
  threadId: string,
  json: string,
  format: number,
): RuntimeThread {
  if (format === 1) return JSON.parse(json) as RuntimeThread;
  if (format !== 2) throw new Error(`Unsupported SQLite checkpoint format: ${format}`);
  const { thread, messageCount, turnCount } = JSON.parse(json) as {
    thread: RuntimeThread; messageCount: number; turnCount: number;
  };
  thread.messages = database.prepare(`
    SELECT message_json FROM thread_messages WHERE thread_id = ? ORDER BY message_index
  `).all(threadId).map((row) => decodeSqliteJson<RuntimeThread['messages'][number]>(row.message_json));
  if (thread.turns) {
    thread.turns = database.prepare(`
      SELECT turn_json FROM thread_turn_checkpoints WHERE thread_id = ? ORDER BY turn_index
    `).all(threadId).map((row) => {
      const { turn, stepCount } = decodeSqliteJson<TurnCheckpoint>(row.turn_json);
      if (stepCount !== undefined) {
        const steps = database.prepare(`
          SELECT event_json FROM runtime_events
          WHERE thread_id = ? AND type = 'turn.step_snapshot' AND turn_id = ? AND seq <= ?
          ORDER BY seq
        `).all(threadId, turn.id, thread.lastSeq).map((eventRow) => {
          const event = decodeSqliteJson<StoredThreadEvent>(eventRow.event_json);
          if (event.type !== 'turn.step_snapshot') throw new Error('Invalid SQLite step snapshot event.');
          return { createdAt: event.createdAt, snapshot: event.payload.snapshot };
        });
        if (steps.length !== stepCount) throw new Error(`Incomplete SQLite step history for ${threadId}:${turn.id}`);
        turn.stepSnapshots = steps;
      }
      return turn;
    });
  }
  if (thread.messages.length !== messageCount || (thread.turns?.length ?? 0) !== turnCount) {
    throw new Error(`Incomplete SQLite checkpoint for ${threadId}`);
  }
  return thread;
}

/** Copy-on-write identities let a checkpoint leave all unchanged historical turns untouched. */
export function syncTurnCheckpoints(
  database: DatabaseSync,
  previous: RuntimeThread | undefined,
  next: RuntimeThread,
): void {
  const previousTurns = previous?.turns ?? [];
  const turns = next.turns ?? [];
  const samePrefix = previous !== undefined && previousTurns.length <= turns.length
    && previousTurns.every((turn, index) => turn.id === turns[index]?.id);
  if (!samePrefix) database.prepare('DELETE FROM thread_turn_checkpoints WHERE thread_id = ?').run(next.id);
  const upsert = database.prepare(`
    INSERT INTO thread_turn_checkpoints(thread_id, turn_index, turn_id, turn_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id, turn_index) DO UPDATE SET turn_id = excluded.turn_id, turn_json = excluded.turn_json
  `);
  for (const [index, turn] of turns.entries()) {
    if (samePrefix && turn === previousTurns[index]) continue;
    const checkpoint: TurnCheckpoint = { turn };
    if (turn.stepSnapshots?.length) {
      const row = database.prepare(`
        SELECT COUNT(*) AS count FROM runtime_events
        WHERE thread_id = ? AND type = 'turn.step_snapshot' AND turn_id = ? AND seq <= ?
      `).get(next.id, turn.id, next.lastSeq);
      // Some legacy snapshots predate their event log. Keep those inline until a lossless
      // event reference is available; ordinary steps have only one durable payload.
      if (Number(row?.count) === turn.stepSnapshots.length) {
        checkpoint.turn = { ...turn, stepSnapshots: undefined };
        checkpoint.stepCount = turn.stepSnapshots.length;
      }
    }
    upsert.run(next.id, index, turn.id, encodeSqliteJson(checkpoint));
  }
}
