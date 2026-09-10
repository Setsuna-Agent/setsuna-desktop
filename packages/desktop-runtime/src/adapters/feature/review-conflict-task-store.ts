import { readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { gitConflictTaskRecordCodec, type WorkspaceGitConflictTask, type GitConflictOperation, type GitConflictTaskRecord } from '@setsuna-desktop/feature-review/contracts';
import type { ThreadStore } from '../../ports/thread-store.js';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';
import { isNodeError } from '../../shared/node-errors.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';

type TaskIndex = Readonly<{
  version: 1;
  threadId: string;
  workspaceRoot: string;
  createdAt: string;
  operation: GitConflictOperation;
  archived?: boolean;
}>;

/** Review owns the durable index; the thread store remains the sole transcript owner. */
export class ReviewConflictTaskStore {
  private readonly directory: string;
  private readonly mutationTails = new Map<string, Promise<unknown>>();
  constructor(dataDir: string, private readonly threads: Pick<ThreadStore, 'getThread'>) {
    this.directory = path.join(dataDir, 'review', 'conflict-tasks');
  }

  async retain(task: Omit<TaskIndex, 'version'>): Promise<void> {
    await writeJsonFile(this.file(task.threadId), { ...task, version: 1 }, { mode: 0o600 });
  }

  async remove(threadId: string): Promise<void> {
    await rm(this.file(threadId), { force: true });
  }

  async setArchived(workspaceRoot: string, threadId: string, archived: boolean): Promise<GitConflictTaskRecord | null> {
    return this.runExclusive(threadId, async () => {
      const root = await realpath(workspaceRoot);
      const entry = await this.readIndex(threadId);
      if (!entry || path.relative(root, entry.workspaceRoot) !== '') return null;
      const thread = await this.threads.getThread(threadId);
      const turn = thread?.turns?.[0];
      if (!turn) return null;
      const result = gitConflictTaskRecordCodec.parse({ ...entry, turnId: turn.id, archived });
      // Archiving only changes visibility. Keep ownership so startup cleanup still
      // preserves the transcript, approvals, and any task that is still running.
      await writeJsonFile(this.file(threadId), { ...entry, archived }, { mode: 0o600 });
      return result;
    });
  }

  async deleteArchived(workspaceRoot: string, threadId: string, deleteThread: (threadId: string) => Promise<void>): Promise<'deleted' | 'not-found' | 'not-archived'> {
    return this.runExclusive(threadId, async () => {
      const entry = await this.readIndex(threadId);
      if (!entry) return 'not-found';
      const root = await realpath(workspaceRoot).catch((error: unknown) => {
        // Archive deletion must also work after a project directory is removed.
        if (isNodeError(error) && error.code === 'ENOENT') return path.resolve(workspaceRoot);
        throw error;
      });
      if (path.relative(root, entry.workspaceRoot) !== '') return 'not-found';
      if (!entry.archived) return 'not-archived';
      const thread = await this.threads.getThread(threadId);
      if (thread && thread.kind !== 'side') return 'not-found';
      // Keep the index until teardown succeeds; a retry can finish index cleanup
      // even if the transcript was already deleted before an I/O failure.
      if (thread) await deleteThread(threadId);
      await this.remove(threadId);
      return 'deleted';
    });
  }

  async retainedThreadIds(): Promise<ReadonlySet<string>> {
    try {
      const entries = await readdir(this.directory, { withFileTypes: true });
      return new Set(entries.filter((entry) => entry.isFile() && /^[A-Za-z0-9_-]+\.json$/u.test(entry.name))
        .map((entry) => entry.name.slice(0, -5)));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return new Set();
      throw error;
    }
  }

  async list(workspaceRoot: string): Promise<readonly GitConflictTaskRecord[]> {
    const root = await realpath(workspaceRoot);
    return (await this.readRecords((entry) => path.relative(root, entry.workspaceRoot) === ''))
      .map((record) => gitConflictTaskRecordCodec.parse(record));
  }

  listArchived(): Promise<readonly WorkspaceGitConflictTask[]> {
    // Read the existing index across all projects, including projects whose
    // directories have since moved. No active workspace or migration is needed.
    return this.readRecords((entry) => entry.archived === true);
  }

  private async readRecords(include: (entry: TaskIndex) => boolean): Promise<readonly WorkspaceGitConflictTask[]> {
    const records: WorkspaceGitConflictTask[] = [];
    for (const threadId of await this.retainedThreadIds()) {
      const entry = await this.readIndex(threadId);
      if (!entry || !include(entry)) continue;
      const thread = await this.threads.getThread(threadId);
      const turn = thread?.turns?.[0];
      // Ownership is saved before starting the turn. A crash in that small window
      // must not delete a transcript; it simply has no history entry yet.
      if (!turn) continue;
      records.push({ ...gitConflictTaskRecordCodec.parse({ ...entry, turnId: turn.id }), workspaceRoot: entry.workspaceRoot });
    }
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.threadId.localeCompare(left.threadId));
  }

  private async readIndex(threadId: string): Promise<TaskIndex | null> {
    const entry = await readJsonFile<TaskIndex | null>(this.file(threadId), null);
    if (entry && (entry.version !== 1 || entry.threadId !== threadId || typeof entry.workspaceRoot !== 'string')) {
      throw new Error('Invalid conflict task index.');
    }
    return entry;
  }

  private async runExclusive<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(threadId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    this.mutationTails.set(threadId, result);
    try { return await result; }
    finally { if (this.mutationTails.get(threadId) === result) this.mutationTails.delete(threadId); }
  }

  private file(threadId: string) {
    return path.join(this.directory, `${assertSafeRuntimeId(threadId, 'Conflict task thread ID')}.json`);
  }
}
