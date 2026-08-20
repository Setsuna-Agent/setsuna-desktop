import { mkdtemp } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SdkMcpConnectionManager } from '../../../src/adapters/mcp/sdk-mcp-connection-manager.js';
import { FileMcpStore } from '../../../src/adapters/store/file-mcp-store.js';
import { InMemorySecretStore } from '../../support/in-memory-secret-store.js';
import { McpRuntimeToolHost } from '../../../src/adapters/tool/mcp-runtime-tool-host.js';
import {
  READ_TOOL_RESULT_TOOL_NAME,
  RuntimeToolRouter,
  TOOL_SEARCH_TOOL_NAME,
} from '../../../src/loop/tools/tool-router.js';
import type { McpClientRuntime } from '../../../src/ports/mcp-client-runtime.js';

describe('mcp runtime tool host', () => {
  it('keeps MCP tools deferred until tool_search activates them', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-runtime-host-test-')), new InMemorySecretStore());
    await store.upsertServer({
      key: 'search_mcp',
      label: 'Search MCP',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      tools: [
        { name: 'fetchCsdnArticle' },
        { name: 'fetchGithubReadme' },
        { name: 'fetchJuejinArticle' },
        { name: 'fetchLinuxDoArticle' },
        { name: 'fetchWebContent' },
        { name: 'search', description: 'Search the live web' },
      ],
    });
    const host = new McpRuntimeToolHost(store, storedInventoryMcpClient());
    const context = runtimeToolContext();
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context,
      orchestrator: null,
      toolHost: host,
    });

    // MCP 工具不进首次请求,只有 tool_search / read_tool_result 直接暴露。
    expect(router.advertisedToolNames()).toEqual([TOOL_SEARCH_TOOL_NAME, READ_TOOL_RESULT_TOOL_NAME]);
    // 6 个工具 + 3 个 MCP resource 工具。
    expect(router.deferredCatalogSize()).toBe(9);
    const searchResult = await router.runToolSearch('search the web', undefined);
    expect(searchResult).toContain('mcp__search_mcp__search');
    expect(router.loadedDeferredToolNames()).toContain('mcp__search_mcp__search');
    await expect(router.systemPrompt()).resolves.toContain('MCP tools are deferred');
  });

  it('keeps large MCP inventories searchable without advertising every tool', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-runtime-host-test-')), new InMemorySecretStore());
    await store.upsertServer({
      key: 'large',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      tools: Array.from({ length: 20 }, (_, index) => ({ name: `lookup_${index + 1}` })),
    });
    const host = new McpRuntimeToolHost(store, storedInventoryMcpClient());
    const context = runtimeToolContext();
    const router = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context,
      orchestrator: null,
      toolHost: host,
    });

    expect(router.advertisedToolNames()).toEqual([TOOL_SEARCH_TOOL_NAME, READ_TOOL_RESULT_TOOL_NAME]);
    // 20 个工具 + 3 个 MCP resource 工具。
    expect(router.deferredCatalogSize()).toBe(23);
    const searchResult = await router.runToolSearch('lookup', undefined);
    expect(searchResult).toContain('mcp__large__lookup_1');
    // 单轮最多激活 8 个具体工具,不把整个 inventory 灌进 tools 后缀。
    expect(router.loadedDeferredToolNames().length).toBe(8);
    await expect(router.systemPrompt()).resolves.toContain('tool_search');
  });

  it('injects instructions only for MCP servers owning tools advertised in this step', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-runtime-host-test-')), new InMemorySecretStore());
    await store.upsertServer({
      key: 'alpha',
      label: 'Alpha MCP',
      transport: 'streamableHttp',
      url: 'https://alpha.example/mcp',
      tools: [{ name: 'lookup_alpha', description: 'Look up alpha records' }],
    });
    await store.upsertServer({
      key: 'beta',
      label: 'Beta MCP',
      transport: 'streamableHttp',
      url: 'https://beta.example/mcp',
      tools: [{ name: 'lookup_beta', description: 'Look up beta records' }],
    });
    const snapshot = vi.fn(async (server: Parameters<McpClientRuntime['snapshot']>[0]) => ({
      serverKey: server.key,
      state: 'ready' as const,
      tools: server.tools ?? [],
      resources: [],
      resourceTemplates: [],
      instructions: `${server.key} server instructions`,
      updatedAt: new Date(0).toISOString(),
    }));
    const client = { ...storedInventoryMcpClient(), snapshot } as McpClientRuntime;
    const host = new McpRuntimeToolHost(store, client);
    const searchRouter = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: host,
    });
    await searchRouter.runToolSearch('mcp__alpha__lookup_alpha', 1);

    const nextStepRouter = await RuntimeToolRouter.create({
      approvalPolicy: 'on-request',
      context: runtimeToolContext(),
      orchestrator: null,
      toolHost: host,
      loadedDeferredToolNames: searchRouter.loadedDeferredToolNames(),
    });
    await expect(nextStepRouter.externalContext()).resolves.toEqual([
      expect.objectContaining({ id: 'mcp_alpha', content: 'alpha server instructions' }),
    ]);
    expect(snapshot.mock.calls.map(([server]) => server.key)).toEqual(['alpha']);
  });

  it('exposes enabled stored MCP tools and calls the backing server', async () => {
    const mcpServer = await createCallableMcpServer();
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-runtime-host-test-')), new InMemorySecretStore());
    await store.upsertServer({
      key: 'search',
      label: 'Search MCP',
      transport: 'streamableHttp',
      url: mcpServer.baseUrl,
      headers: { Authorization: 'Bearer secret' },
      tools: [
        {
          name: 'search_web',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          annotations: { readOnlyHint: true },
        },
        { name: 'write_note', description: 'Write a note' },
      ],
      disabledTools: ['write_note'],
    });

    const mcpConnections = new SdkMcpConnectionManager();
    try {
      const host = new McpRuntimeToolHost(store, mcpConnections);
      const context = { threadId: 'thread_1', turnId: 'turn_1' };
      const tools = await host.listTools(context);

      expect(tools.filter((tool) => tool.name.startsWith('mcp__'))).toEqual([
        expect.objectContaining({
          name: 'mcp__search__search_web',
          description: expect.stringContaining('Search MCP: search_web'),
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        }),
      ]);
      const result = await host.runTool('mcp__search__search_web', { query: 'setsuna' }, context);
      expect(result.content).toBe('result for setsuna');
      expect(result.data).toMatchObject({ serverKey: 'search', toolName: 'search_web' });
      expect(await mcpServer.requests).toEqual([
        { method: 'initialize', authorization: 'Bearer secret', protocolVersion: '', session: '' },
        { method: 'notifications/initialized', authorization: 'Bearer secret', protocolVersion: '2025-11-25', session: 'session_1' },
        { method: 'tools/list', authorization: 'Bearer secret', protocolVersion: '2025-11-25', session: 'session_1' },
        { method: 'tools/call', authorization: 'Bearer secret', protocolVersion: '2025-11-25', session: 'session_1', tool: 'search_web', query: 'setsuna' },
      ]);
    } finally {
      await mcpConnections.shutdown();
      await mcpServer.close();
    }
  });

  it('resolves codex-style bearer and env HTTP headers from stored MCP config', async () => {
    const mcpServer = await createCallableMcpServer();
    const previousToken = process.env.SETSUNA_MCP_RUNTIME_TOKEN;
    const previousAccount = process.env.SETSUNA_MCP_RUNTIME_ACCOUNT;
    process.env.SETSUNA_MCP_RUNTIME_TOKEN = 'runtime-secret';
    process.env.SETSUNA_MCP_RUNTIME_ACCOUNT = 'runtime-account';
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-runtime-host-test-')), new InMemorySecretStore());
    await store.upsertServer({
      key: 'search',
      label: 'Search MCP',
      transport: 'streamableHttp',
      url: mcpServer.baseUrl,
      headers: { 'X-Static': 'static-value' },
      envHttpHeaders: { 'X-Account': 'SETSUNA_MCP_RUNTIME_ACCOUNT' },
      bearerTokenEnvVar: 'SETSUNA_MCP_RUNTIME_TOKEN',
      tools: [{ name: 'search_web', description: 'Search the web' }],
    });

    const mcpConnections = new SdkMcpConnectionManager();
    try {
      const host = new McpRuntimeToolHost(store, mcpConnections);
      const result = await host.runTool('mcp__search__search_web', { query: 'setsuna' }, { threadId: 'thread_1', turnId: 'turn_1' });

      expect(result.content).toBe('result for setsuna');
      expect(await mcpServer.requests).toEqual([
        { method: 'initialize', authorization: 'Bearer runtime-secret', protocolVersion: '', session: '', account: 'runtime-account', staticHeader: 'static-value' },
        { method: 'notifications/initialized', authorization: 'Bearer runtime-secret', protocolVersion: '2025-11-25', session: 'session_1', account: 'runtime-account', staticHeader: 'static-value' },
        { method: 'tools/list', authorization: 'Bearer runtime-secret', protocolVersion: '2025-11-25', session: 'session_1', account: 'runtime-account', staticHeader: 'static-value' },
        { method: 'tools/call', authorization: 'Bearer runtime-secret', protocolVersion: '2025-11-25', session: 'session_1', account: 'runtime-account', staticHeader: 'static-value', tool: 'search_web', query: 'setsuna' },
      ]);
    } finally {
      if (previousToken === undefined) delete process.env.SETSUNA_MCP_RUNTIME_TOKEN;
      else process.env.SETSUNA_MCP_RUNTIME_TOKEN = previousToken;
      if (previousAccount === undefined) delete process.env.SETSUNA_MCP_RUNTIME_ACCOUNT;
      else process.env.SETSUNA_MCP_RUNTIME_ACCOUNT = previousAccount;
      await mcpConnections.shutdown();
      await mcpServer.close();
    }
  });

});

async function createCallableMcpServer(): Promise<{
  baseUrl: string;
  requests: Promise<Array<{ method?: string; authorization?: string; protocolVersion?: string; session?: string; account?: string; staticHeader?: string; tool?: string; query?: string }>>;
  close(): Promise<void>;
}> {
  const requests: Array<{ method?: string; authorization?: string; protocolVersion?: string; session?: string; account?: string; staticHeader?: string; tool?: string; query?: string }> = [];
  let resolveRequests: (requests: Array<{ method?: string; authorization?: string; protocolVersion?: string; session?: string; account?: string; staticHeader?: string; tool?: string; query?: string }>) => void = () => undefined;
  const requestsPromise = new Promise<Array<{ method?: string; authorization?: string; protocolVersion?: string; session?: string; account?: string; staticHeader?: string; tool?: string; query?: string }>>((resolve) => {
    resolveRequests = resolve;
  });
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(405);
      response.end();
      return;
    }
    if (request.method === 'DELETE') {
      response.writeHead(200);
      response.end();
      return;
    }
    const body = JSON.parse(await readRequestText(request)) as {
      id?: string | number;
      method?: string;
      params?: { protocolVersion?: string; name?: string; arguments?: { query?: string } };
    };
    requests.push({
      method: body.method,
      authorization: request.headers.authorization,
      protocolVersion: String(request.headers['mcp-protocol-version'] ?? ''),
      session: String(request.headers['mcp-session-id'] ?? ''),
      ...(request.headers['x-account'] ? { account: String(request.headers['x-account']) } : {}),
      ...(request.headers['x-static'] ? { staticHeader: String(request.headers['x-static']) } : {}),
      ...(body.method === 'tools/call' ? { tool: body.params?.name, query: body.params?.arguments?.query } : {}),
    });
    if (body.method === 'initialize') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'mcp-session-id': 'session_1' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: body.params?.protocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'test-mcp', version: '1.0.0' },
        },
      }));
      return;
    }
    if (body.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (body.method === 'tools/list') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [
            {
              name: 'search_web',
              description: 'Search the web',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
              annotations: { readOnlyHint: true },
            },
            { name: 'write_note', description: 'Write a note', inputSchema: { type: 'object' } },
          ],
        },
      }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        content: [{ type: 'text', text: `result for ${body.params?.arguments?.query ?? ''}` }],
      },
    }));
    resolveRequests(requests);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for MCP test server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: requestsPromise,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function storedInventoryMcpClient(): McpClientRuntime {
  return {
    discoverTools: async (server) => ({ tools: server.tools ?? [], errors: [] }),
    listTools: async (server) => server.tools ?? [],
    listResources: async () => [],
    listResourceTemplates: async () => [],
    readResource: async () => ({ contents: [] }),
    callTool: async () => ({ content: [], isError: false }),
    snapshot: async (server) => ({
      serverKey: server.key,
      state: 'ready',
      tools: server.tools ?? [],
      resources: [],
      resourceTemplates: [],
      updatedAt: new Date(0).toISOString(),
    }),
    login: async () => undefined,
    logout: async () => undefined,
    authStatus: async () => ({ status: 'unsupported' }),
    invalidateServer: async () => undefined,
    releaseScope: async () => undefined,
    releaseThread: async () => undefined,
    shutdown: async () => undefined,
  };
}

function runtimeToolContext() {
  return {
    environment: {
      id: 'temporary_workspace',
      cwd: '/workspace',
      workspaceRoot: '/workspace',
      workspaceRoots: ['/workspace'],
    },
    permissionProfile: 'workspace-write' as const,
    sandboxWorkspaceWrite: {},
    signal: new AbortController().signal,
    threadId: 'thread_1',
    turnId: 'turn_1',
  };
}

async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
