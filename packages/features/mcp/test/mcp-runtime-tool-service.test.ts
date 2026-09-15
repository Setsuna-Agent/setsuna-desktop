import type {
  RuntimeMcpServerInput,
  RuntimeMcpToolInfo,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { McpControl } from '../src/contracts/control.js';
import { McpRuntimeToolServiceImpl } from '../src/runtime/mcp-runtime-tool-service.js';
import { InMemoryMcpStore } from './support/in-memory-mcp-host.js';

describe('McpRuntimeToolServiceImpl', () => {
  it('retains discovery failures per step without exposing credentials or hiding healthy tools', async () => {
    const servers: RuntimeMcpServerInput[] = [
      { key: 'broken', headers: { 'x-api-key': 'private-api-key' } },
      { key: 'healthy', label: 'Documents', description: 'Search team documents' },
      { key: 'disabled', enabled: false },
    ];
    const listTools = vi.fn(async (key: string): Promise<RuntimeMcpToolInfo[]> => {
      if (key === 'broken') throw new Error('401 Unauthorized: private-api-key Bearer private-oauth-token at https://service.test/?token=private-query');
      return [{ name: 'lookup', inputSchema: { type: 'object' } }];
    });
    const control = controlService({ listTools });
    const service = new McpRuntimeToolServiceImpl(control, new InMemoryMcpStore(servers));
    const context = { threadId: 'thread_1' };
    const tools = await service.listTools(context);
    expect(tools.find((tool) => tool.name === 'mcp__healthy__lookup')?.source).toEqual({
      kind: 'mcp', id: 'healthy', name: 'Documents', description: 'Search team documents',
    });
    expect(listTools.mock.calls.map(([key]) => key)).toEqual(['broken', 'healthy']);
    const request = { tools: tools.filter((tool) => tool.name === 'list_mcp_resources') };
    const failures = await service.externalContext(context, request);
    expect(failures).toHaveLength(1);
    expect(JSON.parse(failures[0]!.content)).toMatchObject({ server: 'broken', status: 'tool_discovery_failed', error: expect.stringContaining('401 Unauthorized') });
    expect(failures[0]!.content).not.toContain('private-');
    expect(control.snapshot).not.toHaveBeenCalled();

    listTools.mockResolvedValue([{ name: 'lookup' }]);
    const nextContext = { threadId: 'thread_1' };
    await service.listTools(nextContext);
    await expect(service.externalContext(nextContext, request)).resolves.toEqual([]);
    await expect(service.externalContext(context, request)).resolves.toEqual(failures);
  });

  it('propagates cancellation instead of reporting it as an unavailable integration', async () => {
    const controller = new AbortController();
    const service = new McpRuntimeToolServiceImpl(controlService({ listTools: async () => {
      controller.abort(new Error('turn cancelled'));
      throw controller.signal.reason;
    } }), new InMemoryMcpStore([{ key: 'docs' }]));
    await expect(service.listTools({ threadId: 'thread_1', signal: controller.signal })).rejects.toThrow('turn cancelled');
  });

  it('keeps management prompts separate and preserves one turn tool mapping through execution', async () => {
    let inventory: RuntimeMcpToolInfo[] = [{
      name: 'search',
      description: 'Search current docs',
      inputSchema: { type: 'object' },
    }];
    const control = controlService({
      listTools: vi.fn(async () => inventory),
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'found it' }],
        isError: false,
      })),
    });
    const store = new InMemoryMcpStore([{ key: 'docs', tools: inventory }]);
    const service = new McpRuntimeToolServiceImpl(control, store);
    const onProgress = vi.fn();
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolCallId: 'call_1',
      onProgress,
      modelCapabilities: { supportsImages: true },
    };

    const tools = await service.listTools(context);
    const configure = tools.find((tool) => tool.name === 'configure_mcp_server');
    const search = tools.find((tool) => tool.name === 'mcp__docs__search');
    expect(tools.map((tool) => tool.name)).toEqual([
      'configure_mcp_server',
      'list_mcp_resources',
      'list_mcp_resource_templates',
      'read_mcp_resource',
      'mcp__docs__search',
    ]);
    expect(service.toolRuntimeProfile('configure_mcp_server', context)).toBeNull();
    expect(service.toolRuntimeProfile('mcp__docs__search', context)).toMatchObject({ modelOutputTokenLimit: 8_000 });
    expect(service.systemPrompt(context, { tools: [configure!] })).toContain('configure_mcp_server');
    expect(service.systemPrompt(context, { tools: [configure!] })).not.toContain('Enabled MCP server tools');
    expect(service.systemPrompt(context, { tools: [search!] })).toContain('Enabled MCP server tools');
    expect(service.systemPrompt(context, { tools: [search!] })).not.toContain('current desktop runtime MCP configuration');

    // The server can refresh its inventory between listTools and execution. This turn
    // must still execute the exact mapping the model was shown.
    inventory = [{ name: 'replacement', inputSchema: { type: 'object' } }];
    await expect(service.runTool('mcp__docs__search', { query: 'setsuna' }, context)).resolves.toMatchObject({
      content: 'found it',
    });
    expect(control.listTools).toHaveBeenCalledTimes(1);
    expect(control.callTool).toHaveBeenCalledWith('docs', 'search', { query: 'setsuna' }, expect.objectContaining({
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolCallId: 'call_1',
      toolName: 'mcp__docs__search',
      onProgress,
    }));
  });

  it('loads instructions only from the server owning an advertised MCP tool', async () => {
    const servers: RuntimeMcpServerInput[] = [
      { key: 'alpha', label: 'Alpha MCP', tools: [{ name: 'lookup_alpha' }] },
      { key: 'beta', label: 'Beta MCP', tools: [{ name: 'lookup_beta' }] },
    ];
    const control = controlService({
      listTools: vi.fn(async (serverKey) => servers.find((server) => server.key === serverKey)?.tools ?? []),
      snapshot: vi.fn(async (serverKey) => ({
        serverKey,
        state: 'ready' as const,
        tools: [],
        resources: [],
        resourceTemplates: [],
        instructions: `${serverKey} server instructions`,
        updatedAt: new Date(0).toISOString(),
      })),
    });
    const service = new McpRuntimeToolServiceImpl(control, new InMemoryMcpStore(servers));
    const context = { threadId: 'thread_1' };
    const tools = await service.listTools(context);
    const alpha = tools.find((tool) => tool.name === 'mcp__alpha__lookup_alpha');

    await expect(service.externalContext(context, { tools: [alpha!] })).resolves.toEqual([
      { id: 'mcp_alpha', label: 'Alpha MCP', content: 'alpha server instructions' },
    ]);
    expect(control.snapshot).toHaveBeenCalledTimes(1);
    expect(control.snapshot).toHaveBeenCalledWith('alpha', { threadId: 'thread_1' });
  });
});

function controlService(overrides: Partial<McpControl> = {}): McpControl {
  return {
    listServers: vi.fn(async () => emptyServerList()),
    discoverTools: vi.fn(async () => ({ tools: [], errors: [] })),
    upsertServer: vi.fn(async () => emptyServerList()),
    updateServer: vi.fn(async () => emptyServerList()),
    deleteServer: vi.fn(async () => undefined),
    reloadServers: vi.fn(async () => undefined),
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    authStatus: vi.fn(async () => ({ status: 'unsupported' as const })),
    listTools: vi.fn(async () => []),
    listResources: vi.fn(async () => []),
    listResourceTemplates: vi.fn(async () => []),
    readResource: vi.fn(async () => ({ contents: [] })),
    callTool: vi.fn(async () => ({ content: [], isError: false })),
    snapshot: vi.fn(async (serverKey) => ({
      serverKey,
      state: 'ready' as const,
      tools: [],
      resources: [],
      resourceTemplates: [],
      updatedAt: new Date(0).toISOString(),
    })),
    invalidateServer: vi.fn(async () => undefined),
    releaseThread: vi.fn(async () => undefined),
    ...overrides,
  };
}

function emptyServerList() {
  return {
    configPath: '/tmp/mcp.json',
    workspaceConfigPaths: [],
    errors: [],
    servers: [],
  };
}
