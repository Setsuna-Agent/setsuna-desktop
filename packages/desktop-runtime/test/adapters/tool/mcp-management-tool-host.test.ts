import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SdkMcpConnectionManager } from '../../../src/adapters/mcp/sdk-mcp-connection-manager.js';
import { FileMcpStore } from '../../../src/adapters/store/file-mcp-store.js';
import { InMemorySecretStore } from '../../../src/adapters/store/in-memory-secret-store.js';
import { McpManagementToolHost } from '../../../src/adapters/tool/mcp-management-tool-host.js';

describe('mcp management tool host', () => {
  it('creates and updates MCP servers through the runtime MCP store', async () => {
    const mcpServer = await createDiscoveryMcpServer();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-mcp-toolhost-test-'));
    const store = new FileMcpStore(dataDir, new InMemorySecretStore());
    const mcpConnections = new SdkMcpConnectionManager();
    const host = new McpManagementToolHost(store, mcpConnections);
    const context = { threadId: 'thread_1', turnId: 'turn_1' };
    const configPath = path.join(dataDir, 'mcp.json');

    try {
      const tools = await host.listTools(context);
      expect(tools.map((tool) => tool.name)).toEqual(['configure_mcp_server']);
      const approval = await host.approvalForTool('configure_mcp_server', {
        key: 'Search MCP',
        label: 'Search MCP',
        transport: 'streamableHttp',
        url: mcpServer.baseUrl,
        headers: { Authorization: 'Bearer secret-token' },
        require_approval: 'smart',
      });
      expect(approval?.reason).toContain('创建 MCP 服务');
      expect(JSON.parse(approval?.argumentsPreview ?? '{}')).toMatchObject({ configPath });

      const created = await host.runTool('configure_mcp_server', {
        key: 'Search MCP',
        label: 'Search MCP',
        description: 'Search remote docs',
        transport: 'streamableHttp',
        url: mcpServer.baseUrl,
        headers: { Authorization: 'Bearer secret-token' },
        oauth_client_id: 'client-123',
        oauth_resource: 'https://resource.example.com',
        require_approval: 'smart',
        trust_level: 'trusted',
      }, context);

      expect(created.content).toContain(`Config: ${configPath}`);
      expect(created.content).toContain('Header keys: Authorization');
      expect(created.content).toContain('Tools enabled: 2/2');
      expect(created.content).not.toContain('secret-token');
      expect(created.preview).not.toContain('secret-token');
      await expect(store.listServers()).resolves.toMatchObject({
        configPath,
        servers: [
          {
            key: 'search_mcp',
            label: 'Search MCP',
            description: 'Search remote docs',
            transport: 'streamableHttp',
            url: mcpServer.baseUrl,
            requireApproval: 'auto',
            trustLevel: 'trusted',
            headerKeys: ['Authorization'],
            oauthClientId: 'client-123',
            oauthResource: 'https://resource.example.com',
            tools: [
              { name: 'search_web', description: 'Search the web' },
              { name: 'summarize_page' },
            ],
            readOnly: false,
          },
        ],
      });
      await expect(readFile(configPath, 'utf8')).resolves.not.toContain('secret-token');

      await expect(host.previewToolCall('configure_mcp_server', {
        key: 'search_mcp',
        enabled: false,
      }, context)).resolves.toMatchObject({
        resultPreview: expect.stringContaining('"action":"update"'),
      });

      const updated = await host.runTool('configure_mcp_server', {
        key: 'search_mcp',
        enabled: false,
        timeout_ms: 5000,
      }, context);

      expect(updated.preview).toContain('"action":"update"');
      await expect(store.listServers()).resolves.toMatchObject({
        servers: [
          {
            key: 'search_mcp',
            enabled: false,
            timeoutMs: 5000,
            url: mcpServer.baseUrl,
          },
        ],
      });
    } finally {
      await mcpConnections.shutdown();
      await mcpServer.close();
    }
  });
});

async function createDiscoveryMcpServer(): Promise<{
  baseUrl: string;
  close(): Promise<void>;
}> {
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
      params?: { protocolVersion?: string };
    };
    if (body.method === 'initialize') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'mcp-session-id': 'session_1' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: body.params?.protocolVersion,
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
      id: body.id,
      result: {
        tools: [
          { name: 'summarize_page', inputSchema: { type: 'object' } },
          { name: 'search_web', description: 'Search the web', inputSchema: { type: 'object' } },
        ],
      },
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for MCP discovery server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
