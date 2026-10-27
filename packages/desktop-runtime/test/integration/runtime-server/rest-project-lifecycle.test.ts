import type { RuntimeThread, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

let harness: RuntimeServerTestHarness;
beforeEach(async () => { harness = await createRuntimeServerTestHarness(); });
afterEach(async () => { await harness.close(); });

it.each(['REST', 'AppServer'] as const)('restores the owning project via %s and persists removed-project conversations and archive states', async (transport) => {
  const project = await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ name: 'Unbound project' }) });
  const threads: RuntimeThread[] = [];
  for (const title of ['Restore this conversation', 'Keep archived']) {
    threads.push(await harness.runtimeFetch('/v1/threads', {
      method: 'POST', body: JSON.stringify({ title, projectId: project.id }),
    }));
  }
  await harness.runtimeFetch(`/v1/projects/${project.id}/archive`, { method: 'POST' });
  expect((await harness.runtimeFetch('/v1/projects')).projects).toEqual([]);
  expect((await harness.runtimeFetch('/v1/threads')).threads).toEqual([]);

  await restoreThread(threads[0].id, transport);
  expect((await harness.runtimeFetch('/v1/projects')).projects).toMatchObject([{ id: project.id }]);
  expect((await harness.runtimeFetch('/v1/threads')).threads).toMatchObject([{ id: threads[0].id, projectId: project.id }]);

  await harness.runtimeFetch(`/v1/projects/${project.id}`, { method: 'DELETE' });
  await harness.server.close();
  await harness.startRuntimeServer(harness.runtimeDataDir);
  expect((await harness.runtimeFetch('/v1/projects')).projects).toEqual([]);
  const persisted: RuntimeThreadSummary[] = (await harness.runtimeFetch('/v1/threads?includeArchived=true')).threads;
  expect(persisted).toHaveLength(2);
  expect(persisted.every((thread) => thread.projectId === undefined)).toBe(true);
  expect(persisted.find((thread) => thread.id === threads[0].id)).toMatchObject({ archived: false, title: threads[0].title });
  expect(persisted.find((thread) => thread.id === threads[1].id)).toMatchObject({ archived: true, title: threads[1].title });
  await harness.runtimeFetch(`/v1/threads/${threads[1].id}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) });
  expect((await harness.runtimeFetch('/v1/threads')).threads).toHaveLength(2);
});

it.each(['REST', 'AppServer'] as const)('recovers an archived conversation via %s whose project was removed by an older version', async (transport) => {
  const project = await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ name: 'Legacy project' }) });
  const thread = await harness.runtimeFetch('/v1/threads', {
    method: 'POST', body: JSON.stringify({ projectId: project.id, title: 'Retained conversation' }),
  });
  await harness.runtimeFetch(`/v1/projects/${project.id}/archive`, { method: 'POST' });
  // Old versions removed only the project record, leaving ownership on archived threads.
  await new FileWorkspaceProjectStore(path.join(harness.runtimeDataDir, 'runtime'), systemClock).removeProject(project.id);
  await restoreThread(thread.id, transport);
  const restored = await harness.runtimeFetch(`/v1/threads/${thread.id}`);
  expect(restored.projectId).toBeUndefined();
  expect(restored.archived).toBe(false);
  expect((await harness.runtimeFetch('/v1/threads')).threads).toMatchObject([{ id: thread.id }]);
  expect((await harness.runtimeFetch('/v1/projects')).projects).toEqual([]);
});

async function restoreThread(threadId: string, transport: 'REST' | 'AppServer') {
  if (transport === 'REST') {
    await harness.runtimeFetch(`/v1/threads/${threadId}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) });
  } else {
    await harness.appServerRpc('thread/unarchive', { threadId });
  }
}
