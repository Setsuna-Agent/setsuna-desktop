import { once } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { expect, it, vi } from 'vitest';
import { InMemoryDesktopNativeBridge } from '../../support/in-memory-secret-store.js';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { createMcpToolsServer } from '../../support/runtime-server/mcp.js';

it.each(['authorization', 'token-exchange', 'completed'] as const)(
  'releases OAuth sockets and database ownership when shutting down at %s',
  async (stage) => {
    const originalFetch = globalThis.fetch;
    const issuer = 'https://oauth-fixture.invalid';
    const requests: string[] = [];
    const mcp = await createMcpToolsServer();
    let harness: RuntimeServerTestHarness | undefined;
    let preconnection: Socket | undefined;
    let callback: URL | undefined;
    let rejectToken: (() => void) | undefined;
    let tokenRequested = false;
    const opened = vi.spyOn(InMemoryDesktopNativeBridge.prototype, 'openExternal').mockImplementation(async (url) => {
      const authorization = new URL(url);
      const target = new URL(authorization.searchParams.get('redirect_uri')!);
      target.searchParams.set('state', authorization.searchParams.get('state')!);
      target.searchParams.set('code', 'authorization-code');
      // A browser may preconnect without ever sending an HTTP request on this socket.
      preconnection = createConnection({ host: target.hostname, port: Number(target.port) });
      await once(preconnection, 'connect');
      callback = target;
    });
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin !== issuer) return originalFetch(input, init);
      requests.push(url.pathname);
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        return Response.json({ resource: `${issuer}/mcp`, authorization_servers: [issuer] });
      }
      if (url.pathname === '/.well-known/oauth-authorization-server') return Response.json({
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
      });
      if (url.pathname === '/token') {
        tokenRequested = true;
        if (stage === 'token-exchange') return new Promise<Response>((_resolve, reject) => {
          rejectToken = () => reject(new Error('OAuth fixture closed.'));
          if (init?.signal?.aborted) reject(init.signal.reason);
          else init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
        return Response.json({ access_token: 'fixture-token', token_type: 'Bearer', expires_in: 3600 });
      }
      if (url.pathname === '/mcp') return originalFetch(mcp.baseUrl, init);
      return new Response(null, { status: 404 });
    });
    try {
      const starting = performance.now();
      harness = await createRuntimeServerTestHarness();
      const coldReadyMs = performance.now() - starting;
      await harness.runtimeFetch('/v1/features/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          key: 'docs', transport: 'streamableHttp', url: `${issuer}/mcp`, oauthClientId: 'fixture-client',
        }),
      });
      expect(requests).toEqual([]);
      const login = harness.runtimeFetch('/v1/features/mcp/servers/docs/login', { method: 'POST' })
        .then((value) => ({ value }), (error: unknown) => ({ error }));
      await vi.waitFor(() => expect(callback).toBeDefined());
      if (stage !== 'authorization') {
        const response = await originalFetch(callback!);
        expect(response.status).toBe(200);
        await response.text();
        await vi.waitFor(() => expect(tokenRequested).toBe(true));
      }
      if (stage === 'completed') {
        await vi.waitFor(async () => expect(
          (await harness!.runtimeFetch('/v1/features/mcp/servers')).servers,
        ).toContainEqual(expect.objectContaining({ key: 'docs', authStatus: 'oAuth' })));
        await expect(login).resolves.toMatchObject({
          value: { servers: [expect.objectContaining({ key: 'docs', authStatus: 'oAuth' })] },
        });
      }

      const stopping = performance.now();
      let stopped = false;
      const closing = harness.server.close().then(() => { stopped = true; });
      await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 3_000 });
      await closing;
      await login;
      await vi.waitFor(() => expect(preconnection?.destroyed).toBe(true));
      const shutdownMs = performance.now() - stopping;
      const requestCount = requests.length;
      const restarting = performance.now();
      await harness.startRuntimeServer(harness.runtimeDataDir);
      const restartReadyMs = performance.now() - restarting;
      // Reopen the same database immediately; OAuth must neither retain its lease
      // nor perform discovery/network work on the next runtime's readiness path.
      await expect(harness.runtimeFetch('/health')).resolves.toMatchObject({ ok: true });
      expect(requests).toHaveLength(requestCount);
      expect(opened).toHaveBeenCalledOnce();
      process.stdout.write(`OAuth ${stage} lifecycle (ms): ${JSON.stringify({
        cold: Math.round(coldReadyMs), shutdown: Math.round(shutdownMs), restart: Math.round(restartReadyMs),
      })}\n`);
    } finally {
      rejectToken?.();
      preconnection?.destroy();
      await harness?.close();
      await mcp.close();
      opened.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);
