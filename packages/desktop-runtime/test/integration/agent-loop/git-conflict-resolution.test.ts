import type { ModelRequest, ModelStreamEvent, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { defaultGitSettings } from '@setsuna-desktop/feature-review/contracts';
import { RuntimeGitConflictResolver } from '../../../../features/review/src/runtime/conflict-resolution.js';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { DesktopReviewRuntimeHost } from '../../../src/adapters/feature/review-runtime-host.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import type { ToolHost } from '../../../src/ports/tool-host.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { mkDataDir, TestConfigStore, testRuntimeEnvironment, waitForTurnCancelled, waitForTurnCompleted } from '../../support/agent-loop/shared.js';

const execFileAsync = promisify(execFile);
const git = async (cwd: string, args: string[]) => (await execFileAsync('git', args, { cwd })).stdout.trim();

it.each(['complete', 'cancel'] as const)('can %s an isolated conflict task while the main conversation keeps running', async (outcome) => {
  const root = await mkDataDir();
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '--initial-branch=main']);
  await git(repo, ['config', 'user.name', 'Test']);
  await git(repo, ['config', 'user.email', 'test@example.invalid']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await writeFile(path.join(repo, 'conflict.txt'), 'base\n');
  await git(repo, ['add', 'conflict.txt']);
  await git(repo, ['commit', '-m', 'Base']);
  await git(repo, ['checkout', '-b', 'feature']);
  await writeFile(path.join(repo, 'conflict.txt'), 'theirs\n');
  await git(repo, ['commit', '-am', 'Theirs']);
  await git(repo, ['checkout', 'main']);
  await writeFile(path.join(repo, 'conflict.txt'), 'ours\n');
  await git(repo, ['commit', '-am', 'Ours']);
  await expect(git(repo, ['merge', 'feature'])).rejects.toThrow();
  await writeFile(path.join(repo, 'unrelated.txt'), 'keep this\n');

  const ids = new RandomIdGenerator();
  const threads = createTestThreadStore(root, systemClock, ids);
  const thread = await threads.createThread({ title: 'Main conversation', projectId: 'project' });
  const environments = { resolve: async () => ({ ...testRuntimeEnvironment('project', repo), workspaceProjectId: 'resolved-workspace', repository: { kind: 'git' as const, root: repo, workspacePrefix: '.' } }) };
  const config = new TestConfigStore(modelConfig());
  const requests: ModelRequest[] = [];
  const repairRequests: ModelRequest[] = [];
  let finishMain!: () => void;
  const mainGate = new Promise<void>((resolve) => { finishMain = resolve; });
  const model: ModelClient = {
    async *stream(request): AsyncGenerator<ModelStreamEvent> {
      requests.push(request);
      if (request.providerId === 'chat') {
        yield { type: 'text_delta', text: 'Main task is still running.' };
        await waitForGate(mainGate, request.signal);
        yield { type: 'done', finishReason: 'stop' };
        return;
      }
      repairRequests.push(request);
      if (outcome === 'cancel') await waitForGate(new Promise(() => undefined), request.signal);
      const call = repairRequests.length === 1
        ? { id: 'write', name: 'write_file', arguments: JSON.stringify({ path: 'conflict.txt', content: 'ours and theirs\n' }) }
        : repairRequests.length === 2 ? { id: 'finish', name: 'exec_command', arguments: JSON.stringify({ cmd: 'git add -- conflict.txt && git commit --no-edit' }) } : null;
      if (call) {
        yield { type: 'tool_calls', toolCalls: [call] };
        yield { type: 'done', finishReason: 'tool_calls' };
      } else {
        yield { type: 'text_delta', text: 'Resolved and checked the merge.' };
        yield { type: 'done', finishReason: 'stop' };
      }
    },
  };
  const toolHost: ToolHost = {
    listTools: async () => ['write_file', 'exec_command'].map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })),
    runTool: async (name, input, context) => {
      expect(context.permissionProfile).toBe('workspace-write');
      expect(context.signal).toBeInstanceOf(AbortSignal);
      if (name === 'write_file') {
        expect(input).toEqual({ path: 'conflict.txt', content: 'ours and theirs\n' });
        await writeFile(path.join(repo, 'conflict.txt'), 'ours and theirs\n');
      } else {
        expect(input).toEqual({ cmd: 'git add -- conflict.txt && git commit --no-edit' });
        await git(repo, ['add', '--', 'conflict.txt']);
        await git(repo, ['commit', '--no-edit']);
      }
      return { content: 'Done' };
    },
  };
  const loop = new AgentLoop({ threadStore: threads, modelClient: model, eventBus: new InMemoryEventBus(), clock: systemClock, ids, configStore: config, environmentResolver: environments, toolHost });
  const host = new DesktopReviewRuntimeHost({ dataDir: root, config, models: model, threads, environments, deleteWorkspaceTask: async () => { throw new Error('Deletion is outside this fixture.'); }, activeTurnId: (id) => loop.activeTurnId(id), startTurn: (id, request) => loop.startReviewTurn(id, request), startWorkspaceTaskTurn: (id, request) => loop.startWorkspaceTaskTurn(id, request) });
  const settings = { ...defaultGitSettings(), autoResolveConflicts: true, conflictResolutionModel: { providerId: 'repair', modelId: 'repair-model' }, conflictResolutionPrompt: 'Preserve both changes and check the final Git state.' };
  const resolver = new RuntimeGitConflictResolver({ value: async () => settings }, host);
  await expect(resolver.start({ threadId: thread.id, workspaceRoot: root })).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' });
  expect(requests).toHaveLength(0);
  const mainTurn = await loop.startTurn(thread.id, { input: 'Keep working on my existing task' });
  if (!mainTurn.turnId) throw new Error('Expected the main turn to start.');
  try {
    await vi.waitFor(async () => expect((await threads.getThread(thread.id))?.messages.some((message) => message.content.includes('Main task is still running.'))).toBe(true));
    const sourceBefore = await threads.getThread(thread.id);
    const started = await resolver.start({ threadId: thread.id, workspaceRoot: repo, modelSelection: { providerId: 'chat', modelId: 'chat-model' } });
    if (!started.started) throw new Error('Expected a repair task.');
    expect(started.threadId).not.toBe(thread.id);
    await vi.waitFor(() => expect(repairRequests.length).toBeGreaterThan(0));
    if (outcome === 'cancel') {
      expect(await loop.cancelTurn(started.threadId, started.turnId)).toBe(true);
      await waitForTurnCancelled(threads, started.threadId);
      expect(await git(repo, ['diff', '--name-only', '--diff-filter=U'])).toBe('conflict.txt');
    } else {
      await waitForTurnCompleted(threads, started.threadId, started.turnId);
      expect(repairRequests).toHaveLength(3);
      expect(await git(repo, ['diff', '--name-only', '--diff-filter=U'])).toBe('');
      expect(await git(repo, ['rev-list', '--parents', '-1', 'HEAD'])).toMatch(/^\w+ \w+ \w+$/);
      await expect(resolver.start({ threadId: thread.id, workspaceRoot: repo })).resolves.toEqual({ started: false, reason: 'no-conflicts' });
    }
    expect(repairRequests.every((request) => request.providerId === 'repair' && request.model === 'repair-code')).toBe(true);
    expect(repairRequests[0].tools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(['write_file', 'exec_command']));
    expect(repairRequests[0].messages).toContainEqual(expect.objectContaining({ role: 'user', content: expect.stringContaining(settings.conflictResolutionPrompt) }));
    expect(JSON.stringify(repairRequests[0].messages)).not.toContain('Keep working on my existing task');
    expect(await readFile(path.join(repo, 'unrelated.txt'), 'utf8')).toBe('keep this\n');
    const savedTask = await threads.getThread(started.threadId);
    expect(await host.listGitConflictTasks(repo)).toEqual([{
      threadId: started.threadId, turnId: started.turnId, createdAt: started.createdAt, operation: 'pull',
    }]);
    expect(savedTask).toMatchObject({ kind: 'side', projectId: 'resolved-workspace', memoryMode: 'disabled', modelBinding: { providerId: 'repair', modelId: 'repair-model' } });
    expect((await threads.listThreads()).map((item) => item.id)).toEqual([thread.id]);
    expect((await threads.listEvents(started.threadId, 0)).filter((event) => event.type === 'turn.started')).toHaveLength(1);
    expect(await threads.getThread(thread.id)).toEqual(sourceBefore);
    expect(loop.activeTurnId(thread.id)).toBe(mainTurn.turnId);
    finishMain();
    await waitForTurnCompleted(threads, thread.id, mainTurn.turnId);
    expect((await threads.getThread(thread.id))?.modelBinding).toMatchObject({ providerId: 'chat', modelId: 'chat-model' });
  } finally {
    finishMain();
    for (const item of await threads.listThreads({ includeSide: true })) {
      const active = loop.activeTurnId(item.id);
      if (active) await loop.cancelTurn(item.id, active);
    }
  }
}, 30_000);

function modelConfig(): RuntimeConfigState {
  return {
    approvalPolicy: 'on-request', configPath: '/tmp/config.json', dataPath: '/tmp', globalPrompt: '', permissionProfile: 'workspace-write',
    activeProviderId: 'chat', setsunaStyle: 'developer', storagePath: '/tmp/memories',
    providers: ['chat', 'repair'].map((id) => ({ id, name: id, provider: 'openai-compatible', baseUrl: `https://${id}.example`, enabled: true, apiKeySet: true, apiKeyPreview: '***',
      models: [{ id: `${id}-model`, name: id, code: `${id}-code`, enabled: true, contextWindowTokens: 32000, maxOutputTokens: 4096, thinkingEnabled: false, thinkingEfforts: [] }],
    })),
  };
}

async function waitForGate(gate: Promise<void>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal?.reason ?? new Error('Aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try { await Promise.race([gate, cancelled]); }
  finally { signal?.removeEventListener('abort', onAbort); }
}
