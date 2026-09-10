import { expect, it, vi } from 'vitest';
import { defaultGitSettings, type ReviewRuntimeHost } from '../../src/contracts/index.js';
import { RuntimeGitConflictResolver } from '../../src/runtime/conflict-resolution.js';

const input = { threadId: 'thread_1', workspaceRoot: '/repo', language: 'zh-CN' as const, modelSelection: { providerId: 'chat', modelId: 'chat-model' } };
const task = { threadId: 'repair-thread', turnId: 'repair-turn', createdAt: '2026-09-10T00:00:00Z', operation: 'pull' as const };
function host(): ReviewRuntimeHost {
  return {
    isDefaultModelConfigured: async () => true, generateText: vi.fn(), hasThread: async () => true, listModelOptions: async () => [],
    readGitConflictContext: vi.fn(async () => ({ repositoryRoot: '/repo', files: ['src/conflict.ts'] })),
    resolveModelSelection: vi.fn(async ({ selection, fallback }) => selection ?? fallback),
    listGitConflictTasks: async () => [],
    listArchivedGitConflicts: async () => [],
    deleteGitConflictTask: async () => ({ deleted: false }),
    setGitConflictArchived: async () => { throw new Error('No conflict task in this fixture.'); },
    startWorkspaceTask: vi.fn(async () => task),
    isWorkspaceTaskActive: vi.fn(() => true),
    startTurn: vi.fn(),
  };
}

it('does not inspect or mutate repositories when disabled, and starts no turn without real conflicts', async () => {
  let settings = defaultGitSettings();
  const runtime = host();
  const resolver = new RuntimeGitConflictResolver({ value: async () => settings }, runtime);
  await expect(resolver.start(input)).resolves.toEqual({ started: false, reason: 'disabled' });
  expect(runtime.readGitConflictContext).not.toHaveBeenCalled();
  settings = { ...settings, autoResolveConflicts: true };
  vi.mocked(runtime.readGitConflictContext).mockResolvedValue({ repositoryRoot: '/repo', files: [] });
  await expect(resolver.start(input)).resolves.toEqual({ started: false, reason: 'no-conflicts' });
  expect(runtime.startWorkspaceTask).not.toHaveBeenCalled();
});

it('starts one independent task per repository, retaining custom instructions and the dedicated model', async () => {
  const settings = { ...defaultGitSettings(), autoResolveConflicts: true, conflictResolutionPrompt: 'Custom repair instruction', conflictResolutionModel: { providerId: 'repair', modelId: 'repair-model' } };
  const runtime = host();
  let finish!: (value: typeof task) => void;
  vi.mocked(runtime.startWorkspaceTask).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const resolver = new RuntimeGitConflictResolver({ value: async () => settings }, runtime);
  const first = resolver.start(input);
  await vi.waitFor(() => expect(runtime.startWorkspaceTask).toHaveBeenCalledTimes(1));
  await expect(resolver.start({ ...input, threadId: 'another-source' })).rejects.toMatchObject({ code: 'CONFLICT_RESOLUTION_NOT_STARTED' });
  expect(runtime.startWorkspaceTask).toHaveBeenCalledWith('thread_1', '/repo', expect.objectContaining({
    modelSelection: settings.conflictResolutionModel, title: 'Git 冲突解决',
    prompt: expect.stringContaining('Custom repair instruction'), developerInstructions: expect.stringContaining('normal tools and approval policy'),
  }));
  expect(runtime.startTurn).not.toHaveBeenCalled();
  finish(task);
  await expect(first).resolves.toEqual({ started: true, ...task });
  await expect(resolver.start({ ...input, threadId: 'another-source' })).resolves.toEqual({ started: true, ...task });
  expect(runtime.startWorkspaceTask).toHaveBeenCalledTimes(1);
  vi.mocked(runtime.isWorkspaceTaskActive).mockReturnValue(false);
  vi.mocked(runtime.readGitConflictContext).mockResolvedValue({ repositoryRoot: '/repo', files: [] });
  await expect(resolver.start(input)).resolves.toEqual({ started: false, reason: 'no-conflicts' });
});
