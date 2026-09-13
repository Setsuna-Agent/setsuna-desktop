import { describe, expect, it, vi } from 'vitest';
import { performDeviceOAuth } from '../src/runtime/adapters/sdk/mcp-device-oauth-flow.js';
import { mcpDeviceOAuthProvider } from '../src/runtime/adapters/sdk/mcp-device-oauth-provider.js';

const provider = mcpDeviceOAuthProvider({ key: 'github', url: 'https://api.githubcopilot.com/mcp/' })!;
const code = { device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: provider.verificationUrl, expires_in: 900, interval: 5 };

describe('MCP device authorization protocol', () => {
  it('honors polling/backoff, keeps the private device code off the UI, and never needs a client secret', async () => {
    let now = 0;
    const delays: number[] = [];
    const replies = [code, { error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'private-access-token', token_type: 'bearer' }];
    const requests: { url: string; body: URLSearchParams }[] = [];
    const onAuthorization = vi.fn(async () => undefined);
    const tokens = await performDeviceOAuth(provider, {
      signal: new AbortController().signal, now: () => now,
      wait: async (milliseconds) => { delays.push(milliseconds); now += milliseconds; },
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: new URLSearchParams(init?.body as URLSearchParams) });
        expect(init?.redirect).toBe('error');
        return Response.json(replies.shift());
      }, onAuthorization,
    });
    expect(delays).toEqual([5_000, 5_000, 10_000]);
    expect(onAuthorization.mock.calls).toEqual([[{ userCode: 'ABCD-EFGH', verificationUri: provider.verificationUrl, expiresAt: new Date(900_000).toISOString() }]]);
    expect(tokens.access_token).toBe('private-access-token');
    expect(requests[0]?.body.get('scope')).toBe('repo read:org');
    expect(requests.slice(1).every(({ url, body }) => url === provider.tokenUrl && body.get('device_code') === 'private-device-code')).toBe(true);
    expect(requests.every(({ body }) => body.get('client_id') === provider.clientId && !body.has('client_secret'))).toBe(true);
  });

  it('stops at expiry without polling beyond the code lifetime', async () => {
    let now = 0;
    const fetch = vi.fn(async () => Response.json({ ...code, expires_in: 3 }));
    await expect(performDeviceOAuth(provider, {
      fetch, signal: new AbortController().signal, now: () => now,
      wait: async (milliseconds) => { now += milliseconds; }, onAuthorization: async () => undefined,
    })).rejects.toThrow('code expired');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...code, verification_uri: 'https://attacker.example/device' }, 'Invalid device authorization response'],
    [{ error: 'device_flow_disabled', error_description: 'private-response' }, 'Enable Device Flow'],
    [{ error: 'private-response', error_description: 'private-response' }, 'GitHub device authorization failed'],
  ])('rejects an unsafe or failed authorization response without reflecting its body', async (response, message) => {
    const onAuthorization = vi.fn(async () => undefined);
    await expect(performDeviceOAuth(provider, {
      fetch: async () => Response.json(response), signal: new AbortController().signal, onAuthorization,
    })).rejects.toThrow(message);
    expect(onAuthorization).not.toHaveBeenCalled();
  });
});
