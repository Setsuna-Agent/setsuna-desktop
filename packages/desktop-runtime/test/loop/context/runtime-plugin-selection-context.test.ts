import { pluginMentionText, type RuntimePluginSummary, type RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { RuntimePromptContextAssembler } from '../../../src/loop/context/runtime-prompt-context-assembler.js';

const github: RuntimePluginSummary = {
  id: 'github', name: 'GitHub', description: 'Repository workflows', installedAt: '2026-09-13',
  skills: [], hooks: [], hookCount: 0, resources: [],
  mcpServers: [{ key: 'github', label: 'GitHub MCP', transport: 'streamableHttp', owned: true }],
};
const documents: RuntimePluginSummary = {
  ...github, id: 'documents', name: 'Documents', mcpServers: [],
  skills: [{ id: 'write-doc', name: 'Write a document' }],
};

describe('selected plugin prompt context', () => {
  it('resolves a no-Skill plugin by installed identity and supplies its actual capabilities to the model', async () => {
    const { assembler } = setup();
    const result = await assembler.build({
      ...input(`[$Spoofed name](plugin://github) ${pluginMentionText(github)} [$Missing](plugin://removed)`),
      catalogTools: [githubTool],
    });
    const fragments = result.fragments.filter((fragment) => fragment.source === 'plugin');
    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({ role: 'user', trust: 'external', lifecycle: 'turn' });
    expect(fragments[0]?.content).toContain('"name":"GitHub"');
    expect(fragments[0]?.content).toContain('"availableMcpServers":[{"key":"github","label":"GitHub MCP"}]');
    expect(fragments[0]?.content).toContain('"availableTools":["mcp__github__search"]');
    expect(result.fragments.find((fragment) => fragment.id === 'selected_plugin_policy')).toMatchObject({
      role: 'developer', trust: 'runtime', source: 'tool_policy', content: expect.stringContaining('search_tools'),
    });
    expect(fragments[0]?.content).toContain('list_plugin_connectors');
    expect(fragments[0]?.content).not.toContain('Spoofed');
    expect(result.selectedSkills).toEqual([]);
  });

  it('does not present installed declarations as callable tools and keeps external metadata out of policy', async () => {
    const { assembler } = setup();
    const result = await assembler.build(input(pluginMentionText(github)));
    const metadata = result.fragments.find((fragment) => fragment.id === 'selected_plugin_github')?.content;
    expect(metadata).toContain('"availableTools":[]');
    expect(metadata).toContain('"availableMcpServers":[]');
    expect(metadata).toContain('"unavailableMcpServers":["github"]');
    expect(result.fragments.filter((fragment) => fragment.trust === 'runtime')
      .some((fragment) => fragment.content.includes(github.description!))).toBe(false);
  });

  it('loads associated Skills through the existing registry alongside explicitly selected Skills', async () => {
    const { assembler, resolvePromptContext } = setup();
    const result = await assembler.build({ ...input(pluginMentionText(documents)), skillIds: ['explicit', 'write-doc'] });
    expect(resolvePromptContext).toHaveBeenCalledWith(['explicit', 'write-doc'], expect.anything());
    expect(result.selectedSkills?.map((skill) => skill.id)).toEqual(['explicit', 'write-doc']);
    expect(result.fragments.find((fragment) => fragment.id === 'skill_write-doc')?.content).toContain('Skill instructions');
  });

  it('does not activate quoted examples or bypass the disabled plugins feature', async () => {
    const { assembler, listPlugins } = setup();
    const quoted = await assembler.build(input(`\`${pluginMentionText(github)}\``));
    const disabled = await assembler.build({
      ...input(pluginMentionText(documents)),
      config: {
        configPath: '/config', dataPath: '/data', storagePath: '/memory', providers: [],
        globalPrompt: '', setsunaStyle: 'developer', approvalPolicy: 'on-request', permissionProfile: 'workspace-write',
        features: { plugins: false },
      },
    });
    expect(quoted.fragments.some((fragment) => fragment.source === 'plugin')).toBe(false);
    expect(disabled.fragments.some((fragment) => fragment.source === 'plugin')).toBe(false);
    expect(disabled.selectedSkills).toEqual([]);
    expect(listPlugins).not.toHaveBeenCalled();
  });
});

const githubTool: RuntimeToolDefinition = {
  name: 'mcp__github__search', description: 'Search pull requests', inputSchema: { type: 'object' },
  source: { kind: 'mcp', id: 'github', name: 'GitHub MCP' },
};

function setup() {
  const listPlugins = vi.fn(async () => ({ plugins: [github, documents] }));
  const resolvePromptContext = vi.fn(async (ids: string[]) => ({
    availableSkills: [],
    selectedInjections: ids.map((id) => ({ id, name: id, content: 'Skill instructions' })),
  }));
  return { listPlugins, resolvePromptContext, assembler: new RuntimePromptContextAssembler({
    memoryControl: () => ({ contextMessages: async () => [] }),
    pluginStore: { listPlugins }, skillRegistry: { resolvePromptContext },
  }) };
}

function input(skillActivationText: string): Parameters<RuntimePromptContextAssembler['build']>[0] {
  return {
    config: null, skillActivationText, skillIds: [], hookContextMessages: [],
    thread: {
      id: 'thread_1', projectId: 'project_1', title: 'Plugin task', createdAt: '', updatedAt: '',
      archived: false, messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
    },
    toolContext: {
      interfaceLanguage: 'en-US',
      environment: { id: 'project_1', cwd: '/workspace', workspaceRoot: '/workspace', workspaceRoots: ['/workspace'] },
      threadId: 'thread_1', projectId: 'project_1', turnId: 'turn_1',
      permissionProfile: 'workspace-write', sandboxWorkspaceWrite: {}, signal: new AbortController().signal,
    },
    toolRouter: null, tools: [],
  };
}
