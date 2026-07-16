import { describe, expect, it } from 'vitest';
import { McpOAuthCallbackServer } from './mcp-oauth-callback-server.js';

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
});
