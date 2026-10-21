import { once } from 'node:events';
import { createConnection } from 'node:net';
import { describe, expect, it } from 'vitest';
import { McpOAuthCallbackServer } from '../src/runtime/adapters/sdk/mcp-oauth-callback-server.js';

describe('McpOAuthCallbackServer', () => {
  it('accepts one callback only after validating OAuth state', async () => {
    const callback = new McpOAuthCallbackServer();
    const redirectUrl = await callback.start();
    try {
      const invalid = await fetch(`${redirectUrl}?code=bad&state=wrong`);
      expect(invalid.status).toBe(400);
    } finally {
      await callback.close();
    }
  });

  it('returns the authorization code for a valid callback', async () => {
    const callback = new McpOAuthCallbackServer();
    const redirectUrl = await callback.start();
    try {
      const pending = callback.wait(undefined, 1_000);
      const response = await fetch(`${redirectUrl}?code=auth-code&state=${encodeURIComponent(callback.state)}`);
      expect(response.status).toBe(200);
      await expect(pending).resolves.toEqual({ code: 'auth-code', state: callback.state });
    } finally {
      await callback.close();
    }
  });

  it('finishes cleanup even when the browser leaves an unused preconnection open', async () => {
    const callback = new McpOAuthCallbackServer();
    const redirectUrl = new URL(await callback.start());
    const preconnection = createConnection({ host: redirectUrl.hostname, port: Number(redirectUrl.port) });
    let closing: Promise<void> | undefined;
    try {
      await once(preconnection, 'connect');
      const pending = callback.wait(undefined, 1_000);
      redirectUrl.searchParams.set('code', 'auth-code');
      redirectUrl.searchParams.set('state', callback.state);
      const response = await fetch(redirectUrl);
      await response.text();
      await expect(pending).resolves.toEqual({ code: 'auth-code', state: callback.state });
      const disconnected = once(preconnection, 'close', { signal: AbortSignal.timeout(1_000) });
      closing = callback.close();
      await Promise.all([closing, disconnected]);
    } finally {
      preconnection.destroy();
      await (closing ?? callback.close());
    }
  });
});
