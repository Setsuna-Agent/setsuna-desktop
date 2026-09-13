import { OAuthTokensSchema, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { RuntimeMcpDeviceAuthorization } from '@setsuna-desktop/contracts';
import { setTimeout as delay } from 'node:timers/promises';
import type { McpDeviceOAuthProvider } from './mcp-device-oauth-provider.js';

export type DeviceOAuthFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Device codes stay inside this operation; only the public user code reaches the UI. */
export async function performDeviceOAuth(
  provider: McpDeviceOAuthProvider,
  options: {
    fetch: DeviceOAuthFetch;
    signal: AbortSignal;
    onAuthorization(challenge: RuntimeMcpDeviceAuthorization): Promise<void>;
    now?: () => number;
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<OAuthTokens> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
  const code = await deviceOAuthRequest(provider.deviceUrl, {
    client_id: provider.clientId, scope: provider.scopes.join(' '),
  }, options.fetch, options.signal);
  if (code.error) throw deviceOAuthError(code.error);
  if (typeof code.device_code !== 'string' || !code.device_code || code.device_code.length > 1_024
    || typeof code.user_code !== 'string' || !/^[A-Z0-9-]{4,32}$/u.test(code.user_code)
    || code.verification_uri !== provider.verificationUrl) throw new Error('Invalid device authorization response.');
  const expiresAt = now() + positiveSeconds(code.expires_in, 900, 3_600) * 1_000;
  let interval = positiveSeconds(code.interval, 5, 60) * 1_000;
  await options.onAuthorization({ userCode: code.user_code, verificationUri: provider.verificationUrl, expiresAt: new Date(expiresAt).toISOString() });
  while (now() < expiresAt) {
    await wait(Math.min(interval, expiresAt - now()), options.signal);
    options.signal.throwIfAborted();
    if (now() >= expiresAt) break;
    const result = await deviceOAuthRequest(provider.tokenUrl, {
      client_id: provider.clientId, device_code: code.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }, options.fetch, options.signal);
    if (result.error === 'authorization_pending') continue;
    if (result.error === 'slow_down') { interval += 5_000; continue; }
    if (result.error) throw deviceOAuthError(result.error);
    return parseDeviceOAuthTokens(result);
  }
  throw deviceOAuthError('expired_token');
}

export async function refreshDeviceOAuth(
  provider: McpDeviceOAuthProvider, refreshToken: string, fetch: DeviceOAuthFetch, signal: AbortSignal,
): Promise<OAuthTokens> {
  const result = await deviceOAuthRequest(provider.tokenUrl, {
    client_id: provider.clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
  }, fetch, signal);
  if (result.error) throw deviceOAuthError(result.error);
  return parseDeviceOAuthTokens(result);
}

export async function deviceOAuthRequest(
  url: string, values: Record<string, string>, fetch: DeviceOAuthFetch, signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
  if (!response.ok) throw new Error(`Device authorization request failed (HTTP ${response.status}).`);
  const body = await response.text();
  if (body.length > 32 * 1_024) throw new Error('Device authorization response is too large.');
  try {
    const result: unknown = JSON.parse(body);
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>;
  } catch { /* Do not include secret-bearing response bodies in errors. */ }
  throw new Error('Invalid device authorization response.');
}

function parseDeviceOAuthTokens(value: unknown): OAuthTokens {
  const parsed = OAuthTokensSchema.safeParse(value);
  if (!parsed.success || !parsed.data.access_token || parsed.data.token_type.toLowerCase() !== 'bearer') {
    throw new Error('Invalid device authorization token response.');
  }
  return parsed.data;
}

function positiveSeconds(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error('Invalid device authorization timeout.');
  }
  return value;
}

function deviceOAuthError(code: unknown): Error {
  const messages: Record<string, string> = {
    device_flow_disabled: 'Enable Device Flow in the GitHub OAuth App settings before signing in.',
    incorrect_client_credentials: 'The GitHub OAuth Client ID is invalid.',
    access_denied: 'GitHub authorization was declined.',
    expired_token: 'The GitHub authorization code expired. Start sign-in again.',
    token_expired: 'The GitHub authorization code expired. Start sign-in again.',
    bad_refresh_token: 'GitHub authorization expired. Sign in again.',
  };
  return new Error(typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : 'GitHub device authorization failed. Start sign-in again.');
}
