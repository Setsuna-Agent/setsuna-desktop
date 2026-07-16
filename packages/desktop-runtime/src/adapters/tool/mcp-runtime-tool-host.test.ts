import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { McpClientRuntime } from '../../ports/mcp-client-runtime.js';
import { RuntimeToolRouter } from '../../loop/tool-router.js';
import { FileMcpStore } from '../store/file-mcp-store.js';
import { InMemorySecretStore } from '../store/in-memory-secret-store.js';
import { SdkMcpConnectionManager } from '../mcp/sdk-mcp-connection-manager.js';
import { McpRuntimeToolHost } from './mcp-runtime-tool-host.js';

describe('mcp runtime tool host', () => {
  it('advertises a small MCP inventory directly so providers can discover it without tool_search', async () => {
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

    expect(router.advertisedToolNames()).toEqual(expect.arrayContaining([
      'mcp__search_mcp__fetchWebContent',
      'mcp__search_mcp__search',
    ]));
    expect(router.deferredToolNames()).not.toContain('mcp__search_mcp__search');
    expect(router.routerOwnedToolNames()).toEqual([]);
    await expect(router.systemPrompt()).resolves.toContain('Matching MCP tools are advertised in the current step');
    await expect(router.systemPrompt()).resolves.toContain('mcp__search_mcp__search');
  });

  it('keeps large MCP inventories deferred while exposing a bounded discovery inventory', async () => {
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

    expect(router.advertisedToolNames()).toContain('tool_search');
    expect(router.advertisedToolNames()).not.toContain('mcp__large__lookup_1');
    expect(router.deferredToolNames()).toHaveLength(20);
    await expect(router.systemPrompt()).resolves.toContain('call tool_search');
    await expect(router.systemPrompt()).resolves.toContain('mcp__large__lookup_1');
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
      requireApproval: 'approve',
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
      await expect(host.approvalForTool('mcp__search__search_web', { query: 'setsuna' }, context)).resolves.toBeNull();

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
      requireApproval: 'approve',
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

  it('uses codex-style MCP approval modes', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-runtime-host-test-')), new InMemorySecretStore());
    await store.upsertServer({
      key: 'search',
      label: 'Search MCP',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      requireApproval: 'auto',
      tools: [
        { name: 'fetchWebContent', description: 'Fetch URL content', annotations: { openWorldHint: true } },
        { name: 'read_status', description: 'Read status', annotations: { readOnlyHint: true } },
        { name: 'local_index', description: 'Read local index', annotations: { destructive_hint: false, open_world_hint: false } },
        { name: 'force_prompt', description: 'Always prompt', annotations: { readOnlyHint: true }, approvalMode: 'prompt' },
        { name: 'trusted_write', description: 'Trusted write', approvalMode: 'approve' },
        { name: 'write_note', description: 'Write a note' },
      ],
    });

    const host = new McpRuntimeToolHost(store, storedInventoryMcpClient());
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.approvalForTool('mcp__search__fetchWebContent', { url: 'https://example.com' }, context)).resolves.toMatchObject({
      reason: '调用 MCP 工具：Search MCP / fetchWebContent',
      approvalKeys: ['mcp:search:fetchWebContent'],
      persistentApprovalKeys: ['mcp:search:fetchWebContent'],
    });
    await expect(host.approvalForTool('mcp__search__read_status', {}, context)).resolves.toMatchObject({
      approvalKeys: ['mcp:search:read_status'],
    });
    await expect(host.approvalForTool('mcp__search__local_index', {}, context)).resolves.toMatchObject({
      approvalKeys: ['mcp:search:local_index'],
    });
    await expect(host.approvalForTool('mcp__search__force_prompt', {}, context)).resolves.toEqual({
      reason: '调用 MCP 工具：Search MCP / force_prompt',
    });
    await expect(host.approvalForTool('mcp__search__trusted_write', {}, context)).resolves.toBeNull();
    await expect(host.approvalForTool('mcp__search__write_note', { text: 'note' }, context)).resolves.toMatchObject({
      reason: '调用 MCP 工具：Search MCP / write_note',
      approvalKeys: ['mcp:search:write_note'],
      persistentApprovalKeys: ['mcp:search:write_note'],
    });

    await store.updateServer('search', { trustLevel: 'trusted' });
    const trustedContext = { ...context, turnId: 'turn_trusted' };
    await expect(host.approvalForTool('mcp__search__read_status', {}, trustedContext)).resolves.toBeNull();
    await expect(host.approvalForTool('mcp__search__fetchWebContent', {}, trustedContext)).resolves.toMatchObject({
      approvalKeys: ['mcp:search:fetchWebContent'],
    });
    await expect(host.approvalForTool('mcp__search__force_prompt', {}, trustedContext)).resolves.toEqual({
      reason: '调用 MCP 工具：Search MCP / force_prompt',
    });

    await store.updateServer('search', { requireApproval: 'prompt' });
    await expect(host.approvalForTool('mcp__search__read_status', {}, { ...context, turnId: 'turn_2' })).resolves.toEqual({
      reason: '调用 MCP 工具：Search MCP / read_status',
    });

    await store.updateServer('search', { requireApproval: 'approve' });
    const approvedContext = { ...context, turnId: 'turn_3' };
    await expect(host.approvalForTool('mcp__search__fetchWebContent', { url: 'https://example.com' }, approvedContext)).resolves.toBeNull();
    await expect(host.approvalForTool('mcp__search__write_note', { text: 'note' }, approvedContext)).resolves.toBeNull();

    await store.updateServer('search', { requireApproval: 'always' });
    await expect(host.approvalForTool('mcp__search__read_status', {}, { ...context, turnId: 'turn_4' })).resolves.toEqual({
      reason: '调用 MCP 工具：Search MCP / read_status',
    });

    await store.updateServer('search', { requireApproval: 'never' });
    await expect(host.approvalForTool('mcp__search__fetchWebContent', { url: 'https://example.com' }, { ...context, turnId: 'turn_5' })).resolves.toBeNull();
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
