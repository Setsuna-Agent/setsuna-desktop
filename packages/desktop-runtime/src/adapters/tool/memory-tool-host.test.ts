import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeConfigInput, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { ConfigStore, RuntimeProviderConfig } from '../../ports/config-store.js';
import { systemClock } from '../../ports/clock.js';
import { RandomIdGenerator } from '../id/random-id-generator.js';
import { FileMemoryStore } from '../store/file-memory-store.js';
import { MemoryToolHost } from './memory-tool-host.js';

describe('memory tool host', () => {
  it('exposes remember and recall tools backed by local memory', async () => {
    const store = new FileMemoryStore(await mkdtemp(path.join(tmpdir(), 'setsuna-memory-tool-test-')), systemClock, new RandomIdGenerator());
    const host = new MemoryToolHost(store);
    const context = { threadId: 'thread_1', turnId: 'turn_1', features: { memory_unscoped_files: true } };

    const tools = await host.listTools(context);
    const saved = await host.runTool('remember_memory', {
      content: 'Use the memory port.',
      scope: 'global',
      kind: 'preference',
      title: 'Memory port',
      tags: ['runtime'],
      source: 'test',
    }, context);
    const recalled = await host.runTool('recall_memory', { query: 'memory port' }, context);

    expect(tools.map((tool) => tool.name)).toEqual(['remember_memory', 'recall_memory', 'list_memory_files', 'read_memory_file', 'search_memory_files']);
    expect(saved.content).toContain('Saved memory');
    expect(saved.data).toMatchObject({ kind: 'preference', title: 'Memory port', tags: ['runtime'], source: 'test' });
    expect(recalled.content).toContain('Use the memory port.');
    expect(recalled.content).toContain('source=MEMORY.md:');
    await expect(host.runTool('list_memory_files', {}, context)).resolves.toMatchObject({
      content: expect.stringContaining('"path": "memory_summary.md"'),
    });
    await expect(host.runTool('read_memory_file', { path: 'MEMORY.md', line_offset: 1, max_lines: 8 }, context)).resolves.toMatchObject({
      content: expect.stringContaining('MEMORY.md'),
    });
    await expect(host.runTool('read_memory_file', { path: 'raw_memories.md' }, context)).resolves.toMatchObject({
      content: expect.stringContaining('Use the memory port.'),
    });
    await expect(host.runTool('search_memory_files', { query: 'memory port', case_sensitive: false }, context)).resolves.toMatchObject({
      content: expect.stringContaining('"path": "MEMORY.md"'),
    });
  });

  it('enforces the current thread project boundary for memory tools', async () => {
    const store = new FileMemoryStore(await mkdtemp(path.join(tmpdir(), 'setsuna-memory-tool-scope-test-')), systemClock, new RandomIdGenerator());
    const host = new MemoryToolHost(store);
    await store.rememberMemory({ content: 'Global preference.', scope: 'global' });
    await store.rememberMemory({ content: 'Project alpha convention.', scope: 'project', projectId: 'project_alpha' });
    await store.rememberMemory({ content: 'Project beta secret.', scope: 'project', projectId: 'project_beta' });

    const projectContext = { threadId: 'thread_alpha', turnId: 'turn_1', projectId: 'project_alpha' };
    const projectTools = await host.listTools(projectContext);
    const recalled = await host.runTool('recall_memory', { projectId: 'project_beta' }, projectContext);
    const saved = await host.runTool('remember_memory', {
      content: 'Saved into the current project.',
      scope: 'project',
      projectId: 'project_beta',
    }, projectContext);

    expect(projectTools.map((tool) => tool.name)).toEqual(['remember_memory', 'recall_memory']);
    expect(recalled.content).toContain('Global preference.');
    expect(recalled.content).toContain('Project alpha convention.');
    expect(recalled.content).not.toContain('Project beta secret.');
    expect(saved.data).toMatchObject({ projectId: 'project_alpha' });
    await expect(host.runTool('read_memory_file', { path: 'MEMORY.md' }, projectContext)).rejects.toThrow('unavailable in scoped threads');

    const globalRecall = await host.runTool('recall_memory', {}, { threadId: 'thread_global', turnId: 'turn_2' });
    expect(globalRecall.content).toContain('Global preference.');
    expect(globalRecall.content).not.toContain('Project alpha convention.');
    expect(globalRecall.content).not.toContain('Project beta secret.');
  });

  it('exposes memory tools according to use and generate settings', async () => {
    const store = new FileMemoryStore(await mkdtemp(path.join(tmpdir(), 'setsuna-memory-tool-test-')), systemClock, new RandomIdGenerator());
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const disabled = new MemoryToolHost(store, new StaticConfigStore({ useMemories: false, generateMemories: false, dedicatedTools: true, disableOnExternalContext: true }));
    await expect(disabled.listTools(context)).resolves.toEqual([]);
    await expect(disabled.systemPrompt()).resolves.toBeNull();

    const readOnly = new MemoryToolHost(store, new StaticConfigStore({ useMemories: true, generateMemories: false, dedicatedTools: true, disableOnExternalContext: true }));
    await expect(readOnly.listTools(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'recall_memory' }),
    ]));
    await expect(readOnly.listTools(context)).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'list_memory_files' }),
    ]));
    await expect(readOnly.listTools(context)).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'remember_memory' }),
    ]));

    const writeOnly = new MemoryToolHost(store, new StaticConfigStore({ useMemories: false, generateMemories: true, dedicatedTools: true, disableOnExternalContext: true }));
    await expect(writeOnly.listTools(context)).resolves.toEqual([expect.objectContaining({ name: 'remember_memory' })]);
    await expect(writeOnly.systemPrompt()).resolves.toContain('Use remember_memory only');

    const dedicatedToolsOff = new MemoryToolHost(store, new StaticConfigStore({ useMemories: true, generateMemories: true, dedicatedTools: false, disableOnExternalContext: true }));
    await expect(dedicatedToolsOff.listTools(context)).resolves.toEqual([]);
    await expect(dedicatedToolsOff.systemPrompt()).resolves.toBeNull();
  });
});

class StaticConfigStore implements ConfigStore {
  constructor(private readonly memory: RuntimeConfigState['memory']) {}

  async getConfig(): Promise<RuntimeConfigState> {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memory: this.memory,
      memoryEnabled: this.memory.useMemories || this.memory.generateMemories,
      setsunaStyle: 'developer',
      approvalPolicy: 'on-request',
      permissionProfile: 'workspace-write',
      sandboxWorkspaceWrite: {},
      features: {},
      desktopSettings: {},
    };
  }

  async saveConfig(_input: RuntimeConfigInput): Promise<RuntimeConfigState> {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}
