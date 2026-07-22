import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import {
  createMcpToolsServer,
} from '../../support/runtime-server/mcp.js';

describe('runtime server MCP API', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('stores local MCP server config through the runtime API', async () => {
      const created = await harness.runtimeFetch('/v1/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          key: 'docs',
          label: 'Docs',
          transport: 'streamableHttp',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer secret' },
          tools: [{
            name: 'search',
            description: 'Search docs',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            annotations: { readOnlyHint: true },
          }],
        }),
      });
      const updated = await harness.runtimeFetch('/v1/mcp/servers/docs', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      });
  
      expect(created.servers[0]).toMatchObject({
        key: 'docs',
        transport: 'streamableHttp',
        headerKeys: ['Authorization'],
      });
      expect(JSON.stringify(created)).not.toContain('Bearer secret');
      expect(updated.servers[0]).toMatchObject({ enabled: false });
  
      await expect(harness.appServerRpc('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' })).resolves.toEqual({
        data: [
          {
            name: 'docs',
            serverInfo: null,
            tools: {
              search: {
                name: 'search',
                description: 'Search docs',
                inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
                annotations: { readOnlyHint: true },
              },
            },
            resources: [],
            resourceTemplates: [],
            authStatus: 'bearerToken',
          },
        ],
        nextCursor: null,
      });
      await expect(harness.appServerRpc('mcpServerStatus/list', { limit: 1, detail: 'toolsAndAuthOnly' })).resolves.toMatchObject({
        data: [{ name: 'docs' }],
        nextCursor: null,
      });
      await expect(harness.appServerRpcEnvelope({
        id: 'bad_mcp_cursor',
        method: 'mcpServerStatus/list',
        params: { cursor: 'invalid' },
      })).resolves.toMatchObject({
        id: 'bad_mcp_cursor',
        error: { code: -32600, message: 'invalid cursor: invalid' },
      });
  
      await harness.runtimeFetch('/v1/mcp/servers/docs', { method: 'DELETE' });
      await expect(harness.runtimeFetch('/v1/mcp/servers')).resolves.toMatchObject({ servers: [] });
      await expect(harness.appServerRpc('mcpServerStatus/list', {})).resolves.toEqual({ data: [], nextCursor: null });
    });
  
  it('lists MCP resources and resource templates in AppServer full status', async () => {
      const mcpServer = await createMcpToolsServer();
      try {
        await harness.runtimeFetch('/v1/mcp/servers', {
          method: 'POST',
          body: JSON.stringify({
            key: 'docs',
            label: 'Docs',
            transport: 'streamableHttp',
            url: mcpServer.baseUrl,
            headers: { Authorization: 'Bearer inventory-secret' },
            tools: [{ name: 'search', description: 'Search docs' }],
          }),
        });
  
        await expect(harness.appServerRpc('mcpServerStatus/list', {})).resolves.toEqual({
          data: [
            {
              name: 'docs',
              serverInfo: { name: 'test-mcp', version: '1.0.0' },
              tools: {
                search_web: {
                  name: 'search_web',
                  description: 'Search the web',
                  inputSchema: { type: 'object' },
                },
                summarize_page: {
                  name: 'summarize_page',
                  inputSchema: { type: 'object' },
                },
              },
              resources: [
                {
                  uri: 'memo://hello',
                  name: 'hello',
                  title: 'Hello Memo',
                  description: 'A memo resource',
                  mimeType: 'text/plain',
                },
              ],
              resourceTemplates: [
                {
                  uriTemplate: 'memo://{id}',
                  name: 'memo',
                  title: 'Memo',
                  description: 'Memo by id',
                  mimeType: 'text/plain',
                },
              ],
              authStatus: 'bearerToken',
              connectionState: 'ready',
              protocolVersion: '2025-11-25',
              connectedAt: expect.any(String),
              updatedAt: expect.any(String),
            },
          ],
          nextCursor: null,
        });
        expect(await mcpServer.requests).toEqual(expect.arrayContaining([
          expect.objectContaining({ method: 'resources/list', authorization: 'Bearer inventory-secret' }),
          expect.objectContaining({ method: 'resources/templates/list', authorization: 'Bearer inventory-secret' }),
        ]));
      } finally {
        await mcpServer.close();
      }
    });
  
  it('reports OAuth-configured MCP servers as not logged in in AppServer status', async () => {
      await harness.runtimeFetch('/v1/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          key: 'docs',
          label: 'Docs',
          transport: 'streamableHttp',
          url: 'https://example.com/mcp',
          oauthClientId: 'client-123',
          oauthResource: 'https://resource.example.com',
          tools: [{ name: 'search' }],
        }),
      });
  
      await expect(harness.appServerRpc('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' })).resolves.toEqual({
        data: [
          {
            name: 'docs',
            serverInfo: null,
            tools: {
              search: {
                name: 'search',
                inputSchema: { type: 'object', properties: {}, additionalProperties: true },
              },
            },
            resources: [],
            resourceTemplates: [],
            authStatus: 'notLoggedIn',
          },
        ],
        nextCursor: null,
      });
  
      await harness.runtimeFetch('/v1/mcp/servers/docs', {
        method: 'PATCH',
        body: JSON.stringify({ headers: { Authorization: 'Bearer secret' } }),
      });
  
      await expect(harness.appServerRpc('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' })).resolves.toMatchObject({
        data: [{ name: 'docs', authStatus: 'bearerToken' }],
        nextCursor: null,
      });
    });
  
  it('handles AppServer MCP reload and OAuth login method boundaries', async () => {
      await expect(harness.appServerRpc('config/mcpServer/reload', {})).resolves.toEqual({});
  
      await expect(harness.appServerRpcEnvelope({
        id: 'missing_oauth_server',
        method: 'mcpServer/oauth/login',
        params: { name: 'missing' },
      })).resolves.toMatchObject({
        id: 'missing_oauth_server',
        error: { code: -32600, message: "No MCP server named 'missing' found." },
      });
  
      await harness.runtimeFetch('/v1/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          key: 'local',
          transport: 'stdio',
          command: process.execPath,
        }),
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'stdio_oauth_server',
        method: 'mcpServer/oauth/login',
        params: { name: 'local' },
      })).resolves.toMatchObject({
        id: 'stdio_oauth_server',
        error: { code: -32600, message: 'OAuth login is only supported for streamable HTTP servers.' },
      });
  
      await harness.runtimeFetch('/v1/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          key: 'docs',
          transport: 'streamableHttp',
          url: 'https://example.com/mcp',
          oauthClientId: 'client-123',
        }),
      });
  
      await expect(harness.appServerRpcEnvelope({
        id: 'http_oauth_server',
        method: 'mcpServer/oauth/login',
        params: { name: 'docs', threadId: null, scopes: ['read'], timeoutSecs: 1 },
      })).resolves.toEqual({
        id: 'http_oauth_server',
        result: {},
      });
    });
  
  it('fetches MCP tools through the runtime API', async () => {
      const mcpServer = await createMcpToolsServer();
      try {
        const tools = await harness.runtimeFetch('/v1/mcp/tools', {
          method: 'POST',
          body: JSON.stringify({
            key: 'search',
            transport: 'streamableHttp',
            url: mcpServer.baseUrl,
            headers: { Authorization: 'Bearer secret' },
          }),
        });
  
        expect(tools).toEqual({
          tools: [
            { name: 'search_web', description: 'Search the web', inputSchema: { type: 'object' } },
            { name: 'summarize_page', inputSchema: { type: 'object' } },
          ],
          errors: [],
        });
        expect(await mcpServer.requests).toEqual([
          { method: 'initialize', authorization: 'Bearer secret', session: '' },
          { method: 'notifications/initialized', authorization: 'Bearer secret', session: 'session_1' },
          { method: 'tools/list', authorization: 'Bearer secret', session: 'session_1' },
        ]);
      } finally {
        await mcpServer.close();
      }
    });
  
  it('resolves codex-style MCP bearer and env HTTP headers for discovery', async () => {
      const mcpServer = await createMcpToolsServer();
      const previousToken = process.env.SETSUNA_MCP_TEST_TOKEN;
      const previousAccount = process.env.SETSUNA_MCP_TEST_ACCOUNT;
      process.env.SETSUNA_MCP_TEST_TOKEN = 'env-secret';
      process.env.SETSUNA_MCP_TEST_ACCOUNT = 'account-42';
      try {
        const tools = await harness.runtimeFetch('/v1/mcp/tools', {
          method: 'POST',
          body: JSON.stringify({
            key: 'search',
            transport: 'streamableHttp',
            url: mcpServer.baseUrl,
            headers: { 'X-Static': 'static-header' },
            envHttpHeaders: { 'X-Account': 'SETSUNA_MCP_TEST_ACCOUNT' },
            bearerTokenEnvVar: 'SETSUNA_MCP_TEST_TOKEN',
          }),
        });
  
        expect(tools).toMatchObject({ errors: [] });
        expect(await mcpServer.requests).toEqual([
          { method: 'initialize', authorization: 'Bearer env-secret', session: '', account: 'account-42', staticHeader: 'static-header' },
          { method: 'notifications/initialized', authorization: 'Bearer env-secret', session: 'session_1', account: 'account-42', staticHeader: 'static-header' },
          { method: 'tools/list', authorization: 'Bearer env-secret', session: 'session_1', account: 'account-42', staticHeader: 'static-header' },
        ]);
      } finally {
        if (previousToken === undefined) delete process.env.SETSUNA_MCP_TEST_TOKEN;
        else process.env.SETSUNA_MCP_TEST_TOKEN = previousToken;
        if (previousAccount === undefined) delete process.env.SETSUNA_MCP_TEST_ACCOUNT;
        else process.env.SETSUNA_MCP_TEST_ACCOUNT = previousAccount;
        await mcpServer.close();
      }
    });
  
  it('reads MCP resources through the AppServer API', async () => {
      const mcpServer = await createMcpToolsServer();
      try {
        await harness.runtimeFetch('/v1/mcp/servers', {
          method: 'POST',
          body: JSON.stringify({
            key: 'docs',
            transport: 'streamableHttp',
            url: mcpServer.baseUrl,
            headers: { Authorization: 'Bearer resource-secret' },
          }),
        });
  
        await expect(harness.appServerRpc('mcpServer/resource/read', {
          server: 'docs',
          uri: 'memo://hello',
        })).resolves.toEqual({
          contents: [
            {
              uri: 'memo://hello',
              mimeType: 'text/plain',
              text: 'resource for memo://hello',
            },
          ],
        });
        expect(await mcpServer.requests).toEqual([
          { method: 'initialize', authorization: 'Bearer resource-secret', session: '' },
          { method: 'notifications/initialized', authorization: 'Bearer resource-secret', session: 'session_1' },
          { method: 'resources/read', authorization: 'Bearer resource-secret', session: 'session_1', uri: 'memo://hello' },
        ]);
      } finally {
        await mcpServer.close();
      }
    });
  
  it('calls MCP tools through the AppServer API', async () => {
      const mcpServer = await createMcpToolsServer();
      const startedThread = await harness.appServerRpc('thread/start', { name: 'MCP tool call', cwd: process.cwd() });
      try {
        await harness.runtimeFetch('/v1/mcp/servers', {
          method: 'POST',
          body: JSON.stringify({
            key: 'docs',
            transport: 'streamableHttp',
            url: mcpServer.baseUrl,
            headers: { Authorization: 'Bearer call-secret' },
          }),
        });
  
        await expect(harness.appServerRpc('mcpServer/tool/call', {
          threadId: startedThread.thread.id,
          server: 'docs',
          tool: 'search_web',
          arguments: { query: 'setsuna' },
        })).resolves.toEqual({
          content: [{ type: 'text', text: 'result for setsuna' }],
          structuredContent: { query: 'setsuna', count: 1 },
          isError: false,
          _meta: { source: 'test-mcp' },
        });
        expect(await mcpServer.requests).toEqual([
          { method: 'initialize', authorization: 'Bearer call-secret', session: '' },
          { method: 'notifications/initialized', authorization: 'Bearer call-secret', session: 'session_1' },
          { method: 'tools/call', authorization: 'Bearer call-secret', session: 'session_1', tool: 'search_web', query: 'setsuna' },
        ]);
      } finally {
        await mcpServer.close();
      }
    });
});
