import { createServer } from 'node:http';

import {
  readRequestText
} from './shared.js';

export async function createMcpToolsServer(): Promise<{
  baseUrl: string;
  requests: Promise<Array<{ method?: string; authorization?: string; session?: string; account?: string; staticHeader?: string; uri?: string; tool?: string; query?: string }>>;
  close(): Promise<void>;
}> {
  const requests: Array<{ method?: string; authorization?: string; session?: string; account?: string; staticHeader?: string; uri?: string; tool?: string; query?: string }> = [];
  let resolveRequests: (requests: Array<{ method?: string; authorization?: string; session?: string; account?: string; staticHeader?: string; uri?: string; tool?: string; query?: string }>) => void = () => undefined;
  const requestsPromise = new Promise<Array<{ method?: string; authorization?: string; session?: string; account?: string; staticHeader?: string; uri?: string; tool?: string; query?: string }>>((resolve) => {
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
      params?: { protocolVersion?: string; name?: string; uri?: string; arguments?: { query?: string } };
    };
    requests.push({
      method: body.method,
      authorization: request.headers.authorization,
      session: String(request.headers['mcp-session-id'] ?? ''),
      ...(request.headers['x-account'] ? { account: String(request.headers['x-account']) } : {}),
      ...(request.headers['x-static'] ? { staticHeader: String(request.headers['x-static']) } : {}),
      ...(body.method === 'resources/read' ? { uri: body.params?.uri } : {}),
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
    if (body.method === 'resources/list') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          resources: [
            {
              uri: 'memo://hello',
              name: 'hello',
              title: 'Hello Memo',
              description: 'A memo resource',
              mimeType: 'text/plain',
            },
          ],
        },
      }));
      resolveRequests(requests);
      return;
    }
    if (body.method === 'resources/templates/list') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          resourceTemplates: [
            {
              uriTemplate: 'memo://{id}',
              name: 'memo',
              title: 'Memo',
              description: 'Memo by id',
              mimeType: 'text/plain',
            },
          ],
        },
      }));
      resolveRequests(requests);
      return;
    }
    if (body.method === 'resources/read') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          contents: [
            {
              uri: body.params?.uri,
              mimeType: 'text/plain',
              text: `resource for ${body.params?.uri ?? ''}`,
            },
          ],
        },
      }));
      resolveRequests(requests);
      return;
    }
    if (body.method === 'tools/call') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: `result for ${body.params?.arguments?.query ?? ''}` }],
          structuredContent: { query: body.params?.arguments?.query, count: 1 },
          isError: false,
          _meta: { source: 'test-mcp' },
        },
      }));
      resolveRequests(requests);
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
    resolveRequests(requests);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address for MCP tools server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: requestsPromise,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}