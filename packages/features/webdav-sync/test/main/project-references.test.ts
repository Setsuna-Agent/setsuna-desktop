import { applyRuntimeEventToThread, type RuntimeThread } from '@setsuna-desktop/contracts';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { RandomIdGenerator } from '../../../../desktop-runtime/src/adapters/id/random-id-generator.js';
import { SqliteThreadStore } from '../../../../desktop-runtime/src/adapters/store/sqlite-thread-store.js';
import { FileWorkspaceProjectStore } from '../../../../desktop-runtime/src/adapters/workspace/file-workspace-project-store.js';
import { WorkspaceRuntimeEnvironmentResolver } from '../../../../desktop-runtime/src/adapters/workspace/workspace-runtime-environment-resolver.js';
import { systemClock } from '../../../../desktop-runtime/src/ports/clock.js';
import { remapStagedProjectReferences } from '../../src/main/project-references.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it.each([1, 2])('restores worktree chats to the local project in snapshot format %s, including event replay and summaries', async (format) => {
  const stagingRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-restore-worktree-'));
  roots.push(stagingRoot);
  const dataDir = path.join(stagingRoot, 'runtime');
  const localPath = path.join(stagingRoot, 'local-project');
  await mkdir(localPath);
  const projects = new FileWorkspaceProjectStore(dataDir, systemClock);
  const project = await projects.addProject({ path: localPath });
  const sourceWorkspace = 'worktree_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const store = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
  let thread: RuntimeThread;
  try {
    thread = await store.createThread({ projectId: 'source-project', workspaceId: sourceWorkspace });
    await store.appendEvent(thread.id, {
      id: 'message_event', threadId: thread.id, type: 'message.created', createdAt: thread.createdAt,
      payload: { message: { id: 'message', role: 'user', content: 'Continue', createdAt: thread.createdAt } },
    });
    thread = (await store.getThread(thread.id))!;
  } finally {
    await store.close();
  }
  const database = new DatabaseSync(path.join(dataDir, 'threads.sqlite'));
  try {
    if (format === 1) {
      // Exercise migration from a pre-summary-column backup as well as the current checkpoint format.
      database.prepare('UPDATE threads SET snapshot_json = ?, snapshot_format = 1').run(JSON.stringify(thread));
      database.exec('ALTER TABLE threads DROP COLUMN workspace_id; PRAGMA user_version = 5');
    } else {
      const row = database.prepare('SELECT event_json FROM runtime_events WHERE thread_id = ? AND seq = 1').get(thread.id)!;
      const event = JSON.parse(row.event_json instanceof Uint8Array
        ? gunzipSync(row.event_json).toString('utf8') : String(row.event_json));
      database.prepare('INSERT INTO runtime_event_archives (thread_id, start_seq, end_seq, events_gzip) VALUES (?, 1, 1, ?)')
        .run(thread.id, gzipSync(JSON.stringify([event])));
      database.prepare('DELETE FROM runtime_events WHERE thread_id = ? AND seq = 1').run(thread.id);
    }
  } finally {
    database.close();
  }
  await remapStagedProjectReferences({
    stagingRoot, projectIdMap: new Map([['source-project', project.id]]), targetPaths: new Map([[project.id, localPath]]),
    conversations: true, memories: false,
  });
  const restored = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
  try {
    await restored.recover();
    const snapshot = (await restored.getThread(thread.id))!;
    const summary = (await restored.listThreads())[0];
    expect(snapshot.projectId).toBe(project.id);
    expect(summary.projectId).toBe(project.id);
    expect(snapshot.workspaceId).toBeUndefined();
    expect(summary.workspaceId).toBeUndefined();
    const events = await restored.listEvents(thread.id);
    const created = events.find((event) => event.type === 'thread.created');
    expect(created).toBeDefined();
    expect(created!.payload.workspaceId).toBeUndefined();
    const replayed = events.reduce(applyRuntimeEventToThread, { ...snapshot, messages: [], lastSeq: 0 });
    expect(replayed.workspaceId).toBeUndefined();
    expect(replayed.messages.map((message) => message.content)).toEqual(['Continue']);
    const environment = await new WorkspaceRuntimeEnvironmentResolver(projects).resolve({
      projectId: snapshot.projectId, workspaceId: snapshot.workspaceId, threadId: snapshot.id,
    });
    expect(environment.cwd).toBe(await realpath(localPath));
  } finally {
    await restored.close();
  }
});
