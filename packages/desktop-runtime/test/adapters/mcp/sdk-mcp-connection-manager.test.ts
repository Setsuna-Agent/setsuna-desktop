import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { McpElicitationHandler } from '../../../src/adapters/mcp/mcp-elicitation-coordinator.js';
import {
  SdkMcpConnectionManager,
  stdioTransportEnvironment,
  threadScopeId,
} from '../../../src/adapters/mcp/sdk-mcp-connection-manager.js';
import { InMemoryDesktopNativeBridge } from '../../../src/adapters/store/in-memory-secret-store.js';

describe('SdkMcpConnectionManager', () => {
  it('preserves Electron Node mode only when stdio reuses the current executable', () => {
    const previous = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = '1';
    try {
      expect(stdioTransportEnvironment(process.execPath, undefined)).toMatchObject({ ELECTRON_RUN_AS_NODE: '1' });
      expect(stdioTransportEnvironment('different-node', undefined)).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
      expect(stdioTransportEnvironment(process.execPath, { ELECTRON_RUN_AS_NODE: '0' })).toMatchObject({
        ELECTRON_RUN_AS_NODE: '0',
      });
    } finally {
      if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = previous;
    }
  });

  it('uses newline-delimited stdio, paginates inventory, reuses state and propagates cancellation', async () => {
    const manager = new SdkMcpConnectionManager();
    const server = {
      key: 'stdio_fixture',
      transport: 'stdio' as const,
      command: process.execPath,
      args: [fileURLToPath(new URL('../../fixtures/mcp/test-mcp-stdio-server.mjs', import.meta.url))],
      timeoutMs: 2_000,
      startupTimeoutMs: 2_000,
      toolTimeoutMs: 2_000,
    };
    const context = { scopeId: threadScopeId('thread_stdio') };

    try {
      await expect(manager.listTools(server, context)).resolves.toEqual([
        expect.objectContaining({ name: 'slow' }),
        expect.objectContaining({ name: 'stateful' }),
      ]);
      await expect(manager.listResources(server, context)).resolves.toEqual([
        expect.objectContaining({ uri: 'memo://stdio' }),
      ]);
      await expect(manager.listResourceTemplates(server, context)).resolves.toEqual([
        expect.objectContaining({ uriTemplate: 'memo://{id}' }),
      ]);
      await expect(manager.readResource(server, 'memo://stdio', context)).resolves.toMatchObject({
        contents: [{ uri: 'memo://stdio', text: 'read memo://stdio' }],
      });
      await expect(manager.callTool(server, 'stateful', {}, context)).resolves.toMatchObject({
        content: [{ type: 'text', text: 'stateful call 1' }],
      });
      await expect(manager.callTool(server, 'stateful', {}, context)).resolves.toMatchObject({
        content: [{ type: 'text', text: 'stateful call 2' }],
      });

      const cancellation = new AbortController();
      const slowCall = manager.callTool(server, 'slow', {}, { ...context, signal: cancellation.signal });
      setTimeout(() => cancellation.abort(), 20);
      await expect(slowCall).rejects.toMatchObject({ name: 'AbortError' });
      await expect(manager.callTool(server, 'stateful', {}, context)).resolves.toMatchObject({
        content: [{ type: 'text', text: 'stateful call 3' }],
      });

      await expect(manager.snapshot(server, context)).resolves.toMatchObject({
        state: 'ready',
        serverInfo: { name: 'setsuna-stdio-test', version: '1.0.0' },
        instructions: 'Use this fixture only as external test context.',
      });
      await manager.releaseThread('thread_stdio');
      await expect(manager.callTool(server, 'stateful', {}, context)).resolves.toMatchObject({
        content: [{ type: 'text', text: 'stateful call 1' }],
      });
    } finally {
      await manager.shutdown();
    }
  });

  it('negotiates the current protocol, keeps an HTTP session, refreshes list_changed, and deletes the session', async () => {
    const testServer = await createStatefulHttpMcpServer();
    const manager = new SdkMcpConnectionManager();
    const server = {
      key: 'http_fixture',
      transport: 'streamableHttp' as const,
      url: testServer.url,
      timeoutMs: 2_000,
      startupTimeoutMs: 2_000,
      toolTimeoutMs: 2_000,
    };
    const context = { scopeId: threadScopeId('thread_http') };

    try {
      await expect(manager.listTools(server, context)).resolves.toEqual([
        expect.objectContaining({ name: 'tool_v1' }),
      ]);
      await expect(manager.callTool(server, 'tool_v1', {}, context)).resolves.toMatchObject({
        content: [{ type: 'text', text: 'session session_1' }],
      });
      expect(testServer.initializeCount()).toBe(1);
      expect(testServer.protocolHeaders()).toEqual(['2025-11-25', '2025-11-25', '2025-11-25']);

      await testServer.changeTools();
      await expect.poll(async () => (await manager.listTools(server, context)).map((tool) => tool.name)).toEqual(['tool_v2']);

      await manager.releaseThread('thread_http');
      expect(testServer.deletedSessions()).toEqual(['session_1']);
    } finally {
      await manager.shutdown();
      await testServer.close();
    }
  });

  it('routes form and URL elicitations through the active tool context and retries URL-required tools', async () => {
    const bridge = new InMemoryDesktopNativeBridge();
    const seenModes: string[] = [];
    const elicitationCoordinator: McpElicitationHandler = {
      request: async (_serverKey, params, context) => {
        seenModes.push(params.mode ?? 'form');
        expect(context).toMatchObject({
          threadId: 'thread_elicitation',
          turnId: 'turn_1',
          toolCallId: expect.stringMatching(/^call_/u),
          toolName: expect.stringMatching(/^mcp__/u),
        });
        return params.mode === 'url'
          ? { action: 'accept' }
          : { action: 'accept', content: { displayName: 'Setsuna' } };
      },
    };
    const manager = new SdkMcpConnectionManager({ nativeBridge: bridge, elicitationCoordinator });
    const server = {
      key: 'elicitation_fixture',
      transport: 'stdio' as const,
      command: process.execPath,
      args: [fileURLToPath(new URL('../../fixtures/mcp/test-mcp-elicitation-server.mjs', import.meta.url))],
      timeoutMs: 2_000,
      startupTimeoutMs: 2_000,
      toolTimeoutMs: 2_000,
    };
    const baseContext = {
      scopeId: threadScopeId('thread_elicitation'),
      threadId: 'thread_elicitation',
      turnId: 'turn_1',
    };

    try {
      await expect(manager.callTool(server, 'collect_profile', {}, {
        ...baseContext,
        toolCallId: 'call_form',
        toolName: 'mcp__fixture__collect_profile',
      })).resolves.toMatchObject({ content: [{ type: 'text', text: 'hello Setsuna' }] });
      await expect(manager.callTool(server, 'url_auth', {}, {
        ...baseContext,
        toolCallId: 'call_url',
        toolName: 'mcp__fixture__url_auth',
      })).resolves.toMatchObject({ content: [{ type: 'text', text: 'authorized after 2 calls' }] });
      expect(seenModes).toEqual(['form', 'url']);
      expect(bridge.openedUrls).toEqual(['https://example.com/authorize?one_time_token=secret']);
    } finally {
      await manager.shutdown();
    }
  });
});

async function createStatefulHttpMcpServer(): Promise<{
  url: string;
  initializeCount(): number;
  protocolHeaders(): string[];
  deletedSessions(): string[];
  changeTools(): Promise<void>;
  close(): Promise<void>;
}> {
  let initializeCount = 0;
  let toolVersion = 1;
  const protocolHeaders: string[] = [];
  const deletedSessions: string[] = [];
  let eventStream: ServerResponse | undefined;
  let resolveEventStream: (() => void) | undefined;
  const eventStreamReady = new Promise<void>((resolve) => {
    resolveEventStream = resolve;
  });
  const server = createServer(async (request, response) => {
    const sessionId = String(request.headers['mcp-session-id'] ?? '');
    if (request.method === 'GET') {
      if (!sessionId) {
        response.writeHead(400);
        response.end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write('event: message\nid: initial\ndata:\n\n');
      eventStream = response;
      resolveEventStream?.();
      return;
    }
    if (request.method === 'DELETE') {
      deletedSessions.push(sessionId);
      response.writeHead(200);
      response.end();
      eventStream?.end();
      return;
    }

    const body = JSON.parse(await requestText(request)) as {
      id?: string | number;
      method?: string;
      params?: { protocolVersion?: string; name?: string };
    };
    if (body.method !== 'initialize') protocolHeaders.push(String(request.headers['mcp-protocol-version'] ?? ''));
    if (body.method === 'initialize') {
      initializeCount += 1;
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'MCP-Session-Id': `session_${initializeCount}`,
      });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: body.params?.protocolVersion,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'setsuna-http-test', version: '1.0.0' },
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
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools: [{ name: `tool_v${toolVersion}`, inputSchema: { type: 'object' } }] },
      }));
      return;
    }
    if (body.method === 'tools/call') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: `session ${sessionId}` }] },
      }));
      return;
    }
    response.writeHead(400);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected HTTP test address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    initializeCount: () => initializeCount,
    protocolHeaders: () => protocolHeaders,
    deletedSessions: () => deletedSessions,
    changeTools: async () => {
      await eventStreamReady;
      toolVersion = 2;
      eventStream?.write('event: message\nid: tools-v2\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n');
    },
    close: () => new Promise((resolve, reject) => {
      eventStream?.end();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function requestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}
