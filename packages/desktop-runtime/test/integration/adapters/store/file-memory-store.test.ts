import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RandomIdGenerator } from '../../../../src/adapters/id/random-id-generator.js';
import { FileMemoryStore } from '../../../../src/adapters/store/file-memory-store.js';
import { systemClock } from '../../../../src/ports/clock.js';

describe('file memory store', () => {
  it('serializes concurrent memory writes without losing records', async () => {
    const store = new FileMemoryStore(await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-')), systemClock, new RandomIdGenerator());

    await Promise.all([
      store.rememberMemory({ content: 'Concurrent memory alpha.' }),
      store.rememberMemory({ content: 'Concurrent memory beta.' }),
    ]);

    await expect(store.listMemories()).resolves.toMatchObject({
      memories: expect.arrayContaining([
        expect.objectContaining({ content: 'Concurrent memory alpha.' }),
        expect.objectContaining({ content: 'Concurrent memory beta.' }),
      ]),
    });
  });

  it('stores global and project memories locally', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const memoryRoot = path.join(dataDir, 'memories');
    const store = new FileMemoryStore(dataDir, systemClock, new RandomIdGenerator());

    const global = await store.rememberMemory({ content: 'Prefer concise answers.' });
    const project = await store.rememberMemory({ content: 'This project uses Electron.', scope: 'project', projectId: 'project_1' });

    const all = await store.listMemories();
    const projectScoped = await store.listMemories({ projectId: 'project_1' });
    const search = await store.listMemories({ search: 'electron' });

    expect(global.scope).toBe('global');
    expect(project).toMatchObject({ scope: 'project', projectId: 'project_1' });
    expect(all.memories.map((memory) => memory.id)).toEqual([project.id, global.id]);
    expect(all.memories[0].sourceLocation).toMatchObject({ path: 'MEMORY.md', lineStart: expect.any(Number), lineEnd: expect.any(Number) });
    expect(projectScoped.memories.map((memory) => memory.id)).toEqual([project.id, global.id]);
    expect(search.memories).toMatchObject([{ id: project.id }]);
    await expect(readFile(path.join(memoryRoot, 'MEMORY.md'), 'utf8')).resolves.toContain('This project uses Electron.');
    await expect(readFile(path.join(memoryRoot, 'memory_summary.md'), 'utf8')).resolves.toContain('This project uses Electron.');
    await expect(readFile(path.join(memoryRoot, 'raw_memories.md'), 'utf8')).resolves.toContain('This project uses Electron.');
    await expect(store.listMemoryFiles()).resolves.toMatchObject({
      entries: [
        { path: 'MEMORY.md', entryType: 'file' },
        { path: 'memory_summary.md', entryType: 'file' },
        { path: 'raw_memories.md', entryType: 'file' },
        { path: 'rollout_summaries', entryType: 'directory' },
      ],
      truncated: false,
    });
    await expect(store.listMemoryFiles({ path: 'rollout_summaries' })).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringMatching(/^rollout_summaries\/.+\.md$/), entryType: 'file' }),
      ]),
      truncated: false,
    });
    await expect(store.readMemoryFile({ path: 'memory_summary.md' })).resolves.toMatchObject({
      path: 'memory_summary.md',
      content: expect.stringContaining('This project uses Electron.'),
    });
    await expect(store.readMemoryFile({ path: 'raw_memories.md' })).resolves.toMatchObject({
      path: 'raw_memories.md',
      content: expect.stringContaining('rollout_summary_file:'),
    });
    await expect(store.readMemoryFile({ path: 'MEMORY.md', lineOffset: all.memories[0].sourceLocation?.lineStart, maxLines: 1 })).resolves.toMatchObject({
      path: 'MEMORY.md',
      content: expect.stringContaining('This project uses Electron.'),
      startLineNumber: all.memories[0].sourceLocation?.lineStart,
    });
    const fileSearch = await store.searchMemoryFiles({ queries: ['Electron'], caseSensitive: false });
    expect(fileSearch.truncated).toBe(false);
    expect(fileSearch.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'MEMORY.md', matchedQueries: ['Electron'], content: expect.stringContaining('This project uses Electron.') }),
      expect.objectContaining({ path: 'memory_summary.md', matchedQueries: ['Electron'], content: expect.stringContaining('This project uses Electron.') }),
      expect.objectContaining({ path: 'raw_memories.md', matchedQueries: ['Electron'], content: expect.stringContaining('This project uses Electron.') }),
      expect.objectContaining({ path: expect.stringMatching(/^rollout_summaries\/.+\.md$/), matchedQueries: ['Electron'], content: expect.stringContaining('This project uses Electron.') }),
    ]));

    await store.deleteMemory(project.id);
    await expect(store.listMemories()).resolves.toMatchObject({ memories: [{ id: global.id }] });
    await expect(readFile(path.join(memoryRoot, 'MEMORY.md'), 'utf8')).resolves.not.toContain('This project uses Electron.');
  });

  it('deduplicates active memories by scope, kind, content, and project root', async () => {
    const store = new FileMemoryStore(await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-')), systemClock, new RandomIdGenerator());

    const first = await store.rememberMemory({
      content: '  This project uses pnpm.  ',
      kind: 'project_rule',
      scope: 'project',
      projectId: 'project_1',
      workspaceRoot: '/tmp/project',
      title: 'Package manager',
      tags: ['deps', 'Deps', 'release'],
      source: 'manual',
    });
    const duplicate = await store.rememberMemory({
      content: 'This project uses pnpm.',
      kind: 'project_rule',
      scope: 'project',
      projectId: 'project_1',
      workspaceRoot: '/tmp/project',
      title: 'Package manager again',
    });

    await expect(store.listMemories({ projectId: 'project_1' })).resolves.toMatchObject({
      memories: [
        {
          id: first.id,
          kind: 'project_rule',
          title: 'Package manager',
          tags: ['deps', 'release'],
          source: 'manual',
        },
      ],
    });
    expect(duplicate.id).toBe(first.id);
  });

  it('records cited rollout usage on matching memories', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const store = new FileMemoryStore(dataDir, systemClock, new RandomIdGenerator());
    const cited = await store.rememberMemory({ content: 'Cited memory.', sourceThreadId: 'thread_a' });
    const citedById = await store.rememberMemory({ content: 'Cited by memory id.' });
    await store.rememberMemory({ content: 'Uncited memory.', sourceThreadId: 'thread_b' });

    await expect(store.recordMemoryCitationUsage({
      entries: [],
      rolloutIds: ['thread_a', citedById.id, 'missing'],
    })).resolves.toEqual({
      updated: 2,
      rolloutIds: ['thread_a', citedById.id, 'missing'],
    });

    const memories = await store.listMemories();
    expect(memories.memories.find((memory) => memory.id === cited.id)).toMatchObject({
      usageCount: 1,
      lastUsedAt: expect.any(String),
    });
    expect(memories.memories.find((memory) => memory.id === citedById.id)).toMatchObject({
      usageCount: 1,
      lastUsedAt: expect.any(String),
    });
    expect(memories.memories.find((memory) => memory.content === 'Uncited memory.')?.usageCount).toBeUndefined();

    await expect(store.readMemoryFile({ path: 'MEMORY.md' })).resolves.toMatchObject({
      content: expect.stringContaining('usage_count: 1'),
    });
    await expect(store.readMemoryFile({ path: 'raw_memories.md' })).resolves.toMatchObject({
      content: expect.stringContaining('last_used_at:'),
    });
  });

  it('stores stage-1 outputs and renders Codex-style raw memory artifacts', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const store = new FileMemoryStore(dataDir, systemClock, new RandomIdGenerator());

    const output = await store.recordStage1Output({
      threadId: 'thread_stage1',
      turnId: 'turn_stage1',
      sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
      rawMemory: 'Raw extracted rollout memory.',
      rolloutSummary: 'Summary for routing and indexing.',
      rolloutSlug: 'Memory Startup',
      rolloutPath: '/tmp/rollout.jsonl',
      cwd: '/tmp/project',
      projectId: 'project_1',
    });

    await expect(store.listStage1Outputs()).resolves.toMatchObject({
      outputs: [
        expect.objectContaining({
          id: output.id,
          threadId: 'thread_stage1',
          turnId: 'turn_stage1',
          status: 'succeeded',
          rawMemory: 'Raw extracted rollout memory.',
          rolloutSummary: 'Summary for routing and indexing.',
        }),
      ],
    });
    await expect(store.readMemoryFile({ path: 'raw_memories.md' })).resolves.toMatchObject({
      content: expect.stringContaining('Raw extracted rollout memory.'),
    });
    const summaryFiles = await store.listMemoryFiles({ path: 'rollout_summaries' });
    const summaryFile = summaryFiles.entries.find((entry) => entry.path.includes('memory_startup'));
    expect(summaryFile?.path).toEqual(expect.stringMatching(/^rollout_summaries\/2026-01-01T00-00-00-[0-9a-zA-Z]{4}-memory_startup\.md$/));
    await expect(store.readMemoryFile({ path: summaryFile!.path })).resolves.toMatchObject({
      content: expect.stringContaining('Summary for routing and indexing.'),
    });

    await expect(store.recordMemoryCitationUsage({ entries: [], rolloutIds: ['thread_stage1'] })).resolves.toMatchObject({ updated: 1 });
    await expect(store.listStage1Outputs()).resolves.toMatchObject({
      outputs: [
        expect.objectContaining({
          status: 'succeeded',
          usageCount: 1,
          lastUsedAt: expect.any(String),
        }),
      ],
    });

    await expect(store.recordStage1Output({
      threadId: 'thread_empty',
      turnId: 'turn_empty',
      status: 'succeeded_no_output',
      sourceUpdatedAt: '2026-01-02T00:00:00.000Z',
    })).resolves.toMatchObject({
      threadId: 'thread_empty',
      status: 'succeeded_no_output',
      rawMemory: '',
      rolloutSummary: '',
    });
    await expect(store.readMemoryFile({ path: 'raw_memories.md' })).resolves.toMatchObject({
      content: expect.not.stringContaining('thread_empty'),
    });
  });

  it('prepares a phase-2 snapshot diff without creating a Git repository', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const memoryRoot = path.join(dataDir, 'memories');
    const store = new FileMemoryStore(dataDir, systemClock, new RandomIdGenerator());

    await expect(store.preparePhase2Workspace()).resolves.toMatchObject({
      root: path.resolve(memoryRoot),
      hasChanges: false,
      changes: [],
    });
    await store.recordStage1Output({
      threadId: 'thread_phase2',
      turnId: 'turn_phase2',
      sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
      rawMemory: 'Raw memory for consolidation.',
      rolloutSummary: 'Summary for consolidation.',
      rolloutSlug: 'Phase 2',
    });

    const workspace = await store.syncPhase2Workspace();
    expect(workspace).toMatchObject({
      root: path.resolve(memoryRoot),
      hasChanges: true,
      diffPath: 'phase2_workspace_diff.md',
    });
    expect(workspace.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'A', path: 'raw_memories.md' }),
      expect.objectContaining({ status: 'A', path: expect.stringMatching(/^rollout_summaries\/.+phase_2\.md$/) }),
    ]));
    await expect(readFile(path.join(memoryRoot, 'phase2_workspace_diff.md'), 'utf8')).resolves.toContain('Raw memory for consolidation.');

    await expect(store.resetPhase2WorkspaceBaseline()).resolves.toMatchObject({
      root: path.resolve(memoryRoot),
      hasChanges: false,
      changes: [],
    });
    await expect(store.syncPhase2Workspace()).resolves.toMatchObject({ hasChanges: false, changes: [] });
    await expect(readFile(path.join(memoryRoot, '.git', 'HEAD'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')('refuses a top-level phase-2 directory symlink outside the memory root', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-phase2-outside-test-'));
    const memoryRoot = path.join(dataDir, 'memories');
    const store = new FileMemoryStore(dataDir, systemClock, new RandomIdGenerator());
    await store.preparePhase2Workspace();
    await writeFile(path.join(outsideDir, 'SKILL.md'), 'external phase-2 secret\n', 'utf8');
    await symlink(outsideDir, path.join(memoryRoot, 'skills'));

    await expect(store.syncPhase2Workspace()).rejects.toThrow('refuses symbolic links');
    await expect(readFile(path.join(memoryRoot, 'phase2_workspace_diff.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(outsideDir, 'SKILL.md'), 'utf8')).resolves.toBe('external phase-2 secret\n');
  });

  it('claims phase-2 jobs with lease, cooldown, and watermark guards', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const clock = mutableClock('2026-01-01T00:00:00.000Z');
    const store = new FileMemoryStore(dataDir, clock, new RandomIdGenerator());

    await expect(store.claimPhase2Job({ ownerId: 'thread_empty', leaseSeconds: 60, retryDelaySeconds: 60 })).resolves.toMatchObject({
      status: 'skipped_no_input',
      inputWatermark: 0,
    });

    await store.recordStage1Output({
      threadId: 'thread_phase2_job',
      turnId: 'turn_phase2_job',
      sourceUpdatedAt: '2026-01-01T00:00:10.000Z',
      rawMemory: 'Raw memory that needs consolidation.',
      rolloutSummary: 'Summary that needs consolidation.',
    });

    const claimed = await store.claimPhase2Job({ ownerId: 'thread_phase2_job', leaseSeconds: 60, retryDelaySeconds: 60 });
    expect(claimed).toMatchObject({
      status: 'claimed',
      inputWatermark: 1767225610,
    });
    expect(claimed.ownershipToken).toEqual(expect.any(String));

    await expect(store.claimPhase2Job({ ownerId: 'thread_other', leaseSeconds: 60, retryDelaySeconds: 60 })).resolves.toMatchObject({
      status: 'skipped_running',
      inputWatermark: 1767225610,
    });

    clock.advance(30_000);
    await expect(store.heartbeatPhase2Job({ ownershipToken: claimed.ownershipToken!, leaseSeconds: 120 })).resolves.toBe(true);

    await expect(store.markPhase2JobFailed({
      ownershipToken: claimed.ownershipToken!,
      reason: 'consolidation_agent_unavailable',
      retryDelaySeconds: 60,
    })).resolves.toBe(true);
    await expect(store.claimPhase2Job({ ownerId: 'thread_phase2_job', leaseSeconds: 60, retryDelaySeconds: 60 })).resolves.toMatchObject({
      status: 'skipped_cooldown',
      inputWatermark: 1767225610,
    });

    clock.advance(61_000);
    const retried = await store.claimPhase2Job({ ownerId: 'thread_phase2_job', leaseSeconds: 60, retryDelaySeconds: 60 });
    expect(retried.status).toBe('claimed');
    await expect(store.markPhase2JobSucceeded({
      ownershipToken: retried.ownershipToken!,
      completionWatermark: retried.inputWatermark!,
    })).resolves.toBe(true);
    await expect(store.claimPhase2Job({ ownerId: 'thread_phase2_job', leaseSeconds: 60, retryDelaySeconds: 60 })).resolves.toMatchObject({
      status: 'skipped_no_input',
      inputWatermark: 1767225610,
    });

    await store.recordStage1Output({
      threadId: 'thread_phase2_job_new',
      turnId: 'turn_phase2_job_new',
      sourceUpdatedAt: '2026-01-01T00:02:00.000Z',
      rawMemory: 'New raw memory after the completed watermark.',
      rolloutSummary: 'New summary after the completed watermark.',
    });
    await expect(store.claimPhase2Job({ ownerId: 'thread_phase2_job_new', leaseSeconds: 60, retryDelaySeconds: 60 })).resolves.toMatchObject({
      status: 'claimed',
      inputWatermark: 1767225720,
    });
  });

  it('allows only one concurrent phase-2 lease claim', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const store = new FileMemoryStore(dataDir, mutableClock('2026-01-01T00:00:00.000Z'), new RandomIdGenerator());
    await store.recordStage1Output({
      threadId: 'thread_phase2_race',
      sourceUpdatedAt: '2026-01-01T00:00:10.000Z',
      rawMemory: 'Concurrent phase two input.',
      rolloutSummary: 'Concurrent phase two summary.',
    });

    const claims = await Promise.all([
      store.claimPhase2Job({ ownerId: 'owner_alpha', leaseSeconds: 60, retryDelaySeconds: 60 }),
      store.claimPhase2Job({ ownerId: 'owner_beta', leaseSeconds: 60, retryDelaySeconds: 60 }),
    ]);

    expect(claims.filter((claim) => claim.status === 'claimed')).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === 'skipped_running')).toHaveLength(1);
  });

  it('preserves phase-2 consolidated artifacts and exposes skill files', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const memoryRoot = path.join(dataDir, 'memories');
    const store = new FileMemoryStore(dataDir, systemClock, new RandomIdGenerator());

    await store.rememberMemory({ content: 'Generated fallback memory.' });
    await writeFile(path.join(memoryRoot, 'MEMORY.md'), [
      '# Task Group: Consolidated memory',
      'scope: phase-2 output',
      'applies_to: cwd=/tmp/project; reuse_rule=use for tests',
      '',
    ].join('\n'), 'utf8');
    await writeFile(path.join(memoryRoot, 'memory_summary.md'), 'v1\n\n## User Profile\n\nPhase-2 summary.\n', 'utf8');
    await mkdir(path.join(memoryRoot, 'skills', 'memory-demo'), { recursive: true });
    await writeFile(path.join(memoryRoot, 'skills', 'memory-demo', 'SKILL.md'), '# Memory Demo\n\nReusable memory skill.\n', 'utf8');

    await store.rememberMemory({ content: 'This later JSON memory must not overwrite consolidated files.' });

    await expect(store.readMemoryFile({ path: 'MEMORY.md' })).resolves.toMatchObject({
      content: expect.stringContaining('# Task Group: Consolidated memory'),
    });
    await expect(store.readMemoryFile({ path: 'memory_summary.md' })).resolves.toMatchObject({
      content: expect.stringMatching(/^v1\n/),
    });
    await expect(store.listMemoryFiles()).resolves.toMatchObject({
      entries: expect.arrayContaining([
        { path: 'skills', entryType: 'directory' },
      ]),
    });
    await expect(store.listMemoryFiles({ path: 'skills/memory-demo' })).resolves.toMatchObject({
      entries: [{ path: 'skills/memory-demo/SKILL.md', entryType: 'file' }],
    });
    await expect(store.searchMemoryFiles({ path: 'skills', queries: ['Reusable'] })).resolves.toMatchObject({
      matches: [
        expect.objectContaining({ path: 'skills/memory-demo/SKILL.md', content: expect.stringContaining('Reusable memory skill.') }),
      ],
    });
  });

  it('rejects unsafe memory file paths', async () => {
    const store = new FileMemoryStore(await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-')), systemClock, new RandomIdGenerator());

    await expect(store.readMemoryFile({ path: '/MEMORY.md' })).rejects.toThrow('Invalid memory file path');
    await expect(store.readMemoryFile({ path: 'C:\\Users\\zy\\MEMORY.md' })).rejects.toThrow('Invalid memory file path');
    await expect(store.readMemoryFile({ path: '../MEMORY.md' })).rejects.toThrow('Invalid memory file path');
  });

  it.skipIf(process.platform === 'win32')('refuses memory artifacts symlinked outside the owned root', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-outside-test-'));
    const outsideFile = path.join(outsideDir, 'outside.md');
    const memoryFile = path.join(dataDir, 'memories', 'MEMORY.md');
    const store = new FileMemoryStore(dataDir, systemClock, new RandomIdGenerator());
    await store.rememberMemory({ content: 'Initialize the owned memory root.' });
    await writeFile(outsideFile, 'outside secret\n', 'utf8');
    await rm(memoryFile);
    await symlink(outsideFile, memoryFile);

    await expect(store.readMemoryFile({ path: 'MEMORY.md' })).rejects.toThrow('refuses symbolic links');
    await expect(store.rememberMemory({ content: 'Must not overwrite the symlink target.' })).rejects.toThrow('refuses symbolic links');
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside secret\n');
  });

  it('uses configured storage root while previewing the default fallback root', async () => {
    const defaultDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-default-test-'));
    const customDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-custom-test-'));
    const customMemoryRoot = path.join(customDir, '.setsuna-memory');
    await writeFile(path.join(customDir, 'keep.txt'), 'unrelated user file\n', 'utf8');
    await mkdir(path.join(customDir, '.git'), { recursive: true });
    await writeFile(path.join(customDir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
    let storagePath = '';
    const store = new FileMemoryStore(defaultDir, systemClock, new RandomIdGenerator(), () => storagePath);

    const defaultMemory = await store.rememberMemory({ content: 'Default directory memory.' });
    storagePath = customDir;
    const customMemory = await store.rememberMemory({ content: 'Custom directory memory.' });

    const customIndex = JSON.parse(await readFile(path.join(customMemoryRoot, 'memories.json'), 'utf8'));
    const preview = await store.previewMemories();

    expect(customIndex.memories).toMatchObject([{ id: customMemory.id }]);
    expect(preview.storagePath).toBe(path.resolve(customMemoryRoot));
    expect(preview.items.map((memory) => memory.id)).toEqual(expect.arrayContaining([customMemory.id, defaultMemory.id]));

    await store.deleteMemory(defaultMemory.id);
    await expect(store.listMemories()).resolves.toMatchObject({ memories: [{ id: customMemory.id }] });

    await store.clearMemories();
    await expect(directoryEntries(path.join(defaultDir, 'memories'))).resolves.toEqual(['.setsuna-memory-root.json']);
    await expect(directoryEntries(customMemoryRoot)).resolves.toEqual(['.setsuna-memory-root.json']);
    await expect(readFile(path.join(customDir, 'keep.txt'), 'utf8')).resolves.toBe('unrelated user file\n');
    await expect(readFile(path.join(customDir, '.git', 'HEAD'), 'utf8')).resolves.toBe('ref: refs/heads/main\n');
    await expect(store.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
  });

  it('imports legacy configured memory files once without deleting the source container', async () => {
    const defaultDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-default-test-'));
    const customDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-legacy-test-'));
    await writeFile(path.join(customDir, 'memories.json'), JSON.stringify({
      version: 1,
      memories: [{
        id: 'mem_legacy',
        scope: 'global',
        content: 'Legacy configured memory.',
        origin: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    }), 'utf8');
    await writeFile(path.join(customDir, 'keep.txt'), 'do not delete\n', 'utf8');

    const store = new FileMemoryStore(defaultDir, systemClock, new RandomIdGenerator(), () => customDir);
    await expect(store.listMemories()).resolves.toMatchObject({
      memories: [expect.objectContaining({ id: 'mem_legacy', content: 'Legacy configured memory.' })],
    });
    await expect(readFile(path.join(customDir, '.setsuna-memory', 'memories.json'), 'utf8')).resolves.toContain('mem_legacy');

    await store.clearMemories();
    await expect(store.listMemories()).resolves.toMatchObject({ memories: [] });
    await expect(readFile(path.join(customDir, 'memories.json'), 'utf8')).resolves.toContain('mem_legacy');
    await expect(readFile(path.join(customDir, 'keep.txt'), 'utf8')).resolves.toBe('do not delete\n');
  });
});

async function directoryEntries(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

function mutableClock(iso: string): { now(): Date; advance(ms: number): void } {
  let timestamp = Date.parse(iso);
  return {
    now: () => new Date(timestamp),
    advance: (ms: number) => {
      timestamp += ms;
    },
  };
}
