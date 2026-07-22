import { createServer, type IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { McpOAuthCoordinator, McpOAuthLoginRequiredError } from '../../../src/adapters/mcp/mcp-oauth-coordinator.js';
import { SdkMcpConnectionManager } from '../../../src/adapters/mcp/sdk-mcp-connection-manager.js';
import { InMemoryDesktopNativeBridge } from '../../../src/adapters/store/in-memory-secret-store.js';

describe('McpOAuthCoordinator', () => {
  it('opens the system authorization URL, validates callback state, and persists tokens', async () => {
    const oauthServer = await createOAuthServer();
    const nativeBridge = new AutoCallbackNativeBridge();
    const coordinator = new McpOAuthCoordinator(nativeBridge);
    const server = {
      key: 'docs',
      transport: 'streamableHttp' as const,
      url: `${oauthServer.baseUrl}/mcp`,
      oauthClientId: 'setsuna-test-client',
    };

    try {
      await coordinator.login(server);
      expect(nativeBridge.openedUrls).toHaveLength(1);
      await expect(coordinator.authStatus(server)).resolves.toEqual({ status: 'oAuth' });
      await expect(coordinator.providerFor(server).tokens()).resolves.toMatchObject({ access_token: 'access-token' });

      await coordinator.logout(server);
      await expect(coordinator.authStatus(server)).resolves.toEqual({ status: 'notLoggedIn' });
    } finally {
      await oauthServer.close();
    }
  });

  it('does not open a browser during a normal non-interactive connection', async () => {
    const provider = new McpOAuthCoordinator(new InMemoryDesktopNativeBridge()).providerFor({
      key: 'docs',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
    });

    await expect(provider.redirectToAuthorization(new URL('https://example.com/authorize')))
      .rejects.toBeInstanceOf(McpOAuthLoginRequiredError);
  });

  it('authenticates persistent MCP manager connections after login', async () => {
    const oauthServer = await createOAuthServer();
    const nativeBridge = new AutoCallbackNativeBridge();
    const manager = new SdkMcpConnectionManager({ nativeBridge });
    const server = {
      key: 'docs',
      transport: 'streamableHttp' as const,
      url: `${oauthServer.baseUrl}/mcp`,
      oauthClientId: 'setsuna-test-client',
    };

    try {
      await manager.login(server);
      await expect(manager.listTools(server, { scopeId: 'thread:test' })).resolves.toMatchObject([
        { name: 'search_docs' },
      ]);
      await expect(manager.authStatus(server)).resolves.toEqual({ status: 'oAuth' });
    } finally {
      await manager.shutdown();
      await oauthServer.close();
    }
  });

  it('coalesces concurrent refresh token requests', async () => {
    let refreshCount = 0;
    const server = createServer(async (request, response) => {
      refreshCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'refreshed', token_type: 'Bearer' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected OAuth refresh test address.');
    const fetchFn = new McpOAuthCoordinator(new InMemoryDesktopNativeBridge()).fetchFor('docs');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'refresh' });

    try {
      const [first, second] = await Promise.all([
        fetchFn(`http://127.0.0.1:${address.port}/token`, { body, method: 'POST' }),
        fetchFn(`http://127.0.0.1:${address.port}/token`, { body, method: 'POST' }),
      ]);
      await expect(first.json()).resolves.toMatchObject({ access_token: 'refreshed' });
      await expect(second.json()).resolves.toMatchObject({ access_token: 'refreshed' });
      expect(refreshCount).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

class AutoCallbackNativeBridge extends InMemoryDesktopNativeBridge {
  override async openExternal(url: string): Promise<void> {
    await super.openExternal(url);
    const authorizationUrl = new URL(url);
    const redirectUri = authorizationUrl.searchParams.get('redirect_uri');
    const state = authorizationUrl.searchParams.get('state');
    if (!redirectUri || !state) throw new Error('OAuth authorization URL is missing callback parameters.');
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', 'authorization-code');
    callback.searchParams.set('state', state);
    queueMicrotask(() => { void fetch(callback); });
  }
}

async function createOAuthServer(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  let baseUrl = '';
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', baseUrl || 'http://127.0.0.1');
    if (url.pathname === '/mcp') {
      if (request.headers.authorization !== 'Bearer access-token') {
        response.writeHead(401, {
          'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`,
        });
        response.end();
        return;
      }
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
      const message = JSON.parse(await requestText(request)) as { id?: string | number; method?: string; params?: { protocolVersion?: string } };
      if (message.method === 'notifications/initialized') {
        response.writeHead(202);
        response.end();
        return;
      }
      json(response, {
        jsonrpc: '2.0',
        id: message.id,
        result: message.method === 'initialize'
          ? {
              protocolVersion: message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'oauth-test', version: '1.0.0' },
            }
          : { tools: [{ name: 'search_docs', inputSchema: { type: 'object' } }] },
      });
      return;
    }
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp'
      || url.pathname === '/.well-known/oauth-protected-resource') {
      json(response, {
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        scopes_supported: ['mcp:tools'],
      });
      return;
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      json(response, {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
      return;
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      const body = new URLSearchParams(await requestText(request));
      if (body.get('grant_type') !== 'authorization_code' || body.get('code') !== 'authorization-code' || !body.get('code_verifier')) {
        json(response, { error: 'invalid_grant' }, 400);
        return;
      }
      json(response, {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected OAuth test address.');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function json(response: import('node:http').ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function requestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
