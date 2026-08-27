import type { RuntimeMcpServerInput } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { McpProtocolService } from '../src/runtime/mcp-control-service.js';
import { McpControlService } from '../src/runtime/mcp-control-service.js';
import { McpManagementTools } from '../src/runtime/tools/management-tools.js';
import { InMemoryMcpStore } from './support/in-memory-mcp-host.js';

describe('McpControlService', () => {
  it('discovers an update with the complete stored connection configuration', async () => {
    const store = new InMemoryMcpStore([storedServer()]);
    const protocol = protocolService();
    const control = new McpControlService(store, protocol);

    await control.discoverTools({ key: 'docs', enabled: false });

    expect(protocol.discoverTools).toHaveBeenCalledWith(expect.objectContaining({
      key: 'docs',
      enabled: false,
      url: 'https://example.com/mcp',
      headers: { 'X-Static': 'stored-value' },
      envHttpHeaders: { 'X-Account': 'SETSUNA_MCP_ACCOUNT' },
      bearerTokenEnvVar: 'SETSUNA_MCP_TOKEN',
    }), undefined);
  });

  it('owns configuration invalidation and enriches auth only when requested', async () => {
    const store = new InMemoryMcpStore([storedServer()]);
    const protocol = protocolService();
    const control = new McpControlService(store, protocol);

    await control.updateServer('docs', { enabled: false });
    expect(protocol.invalidateServer).toHaveBeenCalledTimes(1);
    expect(protocol.invalidateServer).toHaveBeenCalledWith('docs');

    await expect(control.listServers()).resolves.toMatchObject({
      servers: [{ key: 'docs', enabled: false }],
    });
    expect(protocol.authStatus).not.toHaveBeenCalled();

    await expect(control.listServers({ includeAuthStatus: true })).resolves.toMatchObject({
      servers: [{ key: 'docs', authStatus: 'oAuth' }],
    });
    expect(protocol.authStatus).toHaveBeenCalledTimes(1);
  });

  it('creates and updates servers through one control transaction without exposing secrets', async () => {
    const store = new InMemoryMcpStore();
    const protocol = protocolService({
      discoverTools: vi.fn(async () => ({
        tools: [
          { name: 'search_web', description: 'Search the web' },
          { name: 'summarize_page' },
        ],
        errors: [],
      })),
    });
    const tools = new McpManagementTools(new McpControlService(store, protocol));

    const created = await tools.runTool('configure_mcp_server', {
      key: 'Search MCP',
      label: 'Search MCP',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(created.content).toContain('Tools enabled: 2/2');
    expect(created.content).toContain('Header keys: Authorization');
    expect(JSON.stringify(created)).not.toContain('secret-token');

    const updated = await tools.runTool('configure_mcp_server', {
      key: 'search_mcp',
      enabled: false,
      timeout_ms: 5_000,
    });
    expect(updated.preview).toContain('"action":"update"');
    await expect(store.listServerInputs()).resolves.toEqual([
      expect.objectContaining({
        key: 'search_mcp',
        enabled: false,
        timeoutMs: 5_000,
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer secret-token' },
      }),
    ]);
    expect(protocol.discoverTools).toHaveBeenLastCalledWith(expect.objectContaining({
      key: 'search_mcp',
      enabled: false,
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer secret-token' },
    }), undefined);
    expect(protocol.invalidateServer).toHaveBeenCalledTimes(2);
  });
});

function storedServer(): RuntimeMcpServerInput {
  return {
    key: 'docs',
    transport: 'streamableHttp',
    url: 'https://example.com/mcp',
    headers: { 'X-Static': 'stored-value' },
    envHttpHeaders: { 'X-Account': 'SETSUNA_MCP_ACCOUNT' },
    bearerTokenEnvVar: 'SETSUNA_MCP_TOKEN',
  };
}

function protocolService(overrides: Partial<McpProtocolService> = {}): McpProtocolService {
  return {
    discoverTools: vi.fn(async () => ({ tools: [], errors: [] })),
    listTools: vi.fn(async () => []),
    listResources: vi.fn(async () => []),
    listResourceTemplates: vi.fn(async () => []),
    readResource: vi.fn(async () => ({ contents: [] })),
    callTool: vi.fn(async () => ({ content: [], isError: false })),
    snapshot: vi.fn(async (server) => ({
      serverKey: server.key,
      state: 'ready' as const,
      tools: [],
      resources: [],
      resourceTemplates: [],
      updatedAt: new Date(0).toISOString(),
    })),
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    authStatus: vi.fn(async () => ({ status: 'oAuth' as const })),
    invalidateServer: vi.fn(async () => undefined),
    releaseThread: vi.fn(async () => undefined),
    ...overrides,
  };
}
