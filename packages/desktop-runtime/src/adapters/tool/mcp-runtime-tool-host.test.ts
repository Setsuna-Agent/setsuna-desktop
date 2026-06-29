import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileMcpStore } from '../store/file-mcp-store.js';
import { McpRuntimeToolHost } from './mcp-runtime-tool-host.js';

describe('mcp runtime tool host', () => {
  it('exposes enabled stored MCP tools and calls the backing server', async () => {
    const mcpServer = await createCallableMcpServer();
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-runtime-host-test-')));
    await store.upsertServer({
      key: 'search',
      label: 'Search MCP',
      transport: 'streamableHttp',
      url: mcpServer.baseUrl,
      headers: { Authorization: 'Bearer secret' },
      requireApproval: 'never',
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

    try {
      const host = new McpRuntimeToolHost(store);
      const context = { threadId: 'thread_1', turnId: 'turn_1' };
      const tools = await host.listTools(context);

      expect(tools).toEqual([
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
        { method: 'initialize', authorization: 'Bearer secret', session: '' },
        { method: 'notifications/initialized', authorization: 'Bearer secret', session: 'session_1' },
        { method: 'tools/call', authorization: 'Bearer secret', session: 'session_1', tool: 'search_web', query: 'setsuna' },
      ]);
    } finally {
      await mcpServer.close();
    }
  });

  it('uses explicit always or never approval policy for all MCP tools', async () => {
    const store = new FileMcpStore(await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-runtime-host-test-')));
    await store.upsertServer({
      key: 'search',
      label: 'Search MCP',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      requireApproval: 'always',
      tools: [
        { name: 'fetchWebContent', description: 'Fetch URL content' },
        { name: 'write_note', description: 'Write a note' },
      ],
    });

    const host = new McpRuntimeToolHost(store);
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    await expect(host.approvalForTool('mcp__search__fetchWebContent', { url: 'https://example.com' }, context)).resolves.toMatchObject({
      reason: '调用 MCP 工具：Search MCP / fetchWebContent',
    });
    await expect(host.approvalForTool('mcp__search__write_note', { text: 'note' }, context)).resolves.toMatchObject({
      reason: '调用 MCP 工具：Search MCP / write_note',
    });

    await store.updateServer('search', { requireApproval: 'never' });
    await expect(host.approvalForTool('mcp__search__fetchWebContent', { url: 'https://example.com' }, context)).resolves.toBeNull();
    await expect(host.approvalForTool('mcp__search__write_note', { text: 'note' }, context)).resolves.toBeNull();
  });
});

async function createCallableMcpServer(): Promise<{
  baseUrl: string;
  requests: Promise<Array<{ method?: string; authorization?: string; session?: string; tool?: string; query?: string }>>;
  close(): Promise<void>;
}> {
  const requests: Array<{ method?: string; authorization?: string; session?: string; tool?: string; query?: string }> = [];
  let resolveRequests: (requests: Array<{ method?: string; authorization?: string; session?: string; tool?: string; query?: string }>) => void = () => undefined;
  const requestsPromise = new Promise<Array<{ method?: string; authorization?: string; session?: string; tool?: string; query?: string }>>((resolve) => {
    resolveRequests = resolve;
  });
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await readRequestText(request)) as { method?: string; params?: { name?: string; arguments?: { query?: string } } };
    requests.push({
      method: body.method,
      authorization: request.headers.authorization,
      session: String(request.headers['mcp-session-id'] ?? ''),
      ...(body.method === 'tools/call' ? { tool: body.params?.name, query: body.params?.arguments?.query } : {}),
    });
    if (body.method === 'initialize') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'mcp-session-id': 'session_1' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
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
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
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

async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
