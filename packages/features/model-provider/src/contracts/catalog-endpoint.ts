import type { ModelProviderKind } from '@setsuna-desktop/contracts';

/** Compare catalog identities without rewriting the endpoint stored in user settings. */
export function normalizeCatalogEndpoint(baseUrl: string, provider: ModelProviderKind): string {
  const normalized = baseUrl.trim().replace(/\/+$/u, '').toLocaleLowerCase();
  // Go previously shared one endpoint; Pi now lists a separate path for each protocol.
  if (/^https:\/\/opencode\.ai\/(?:zen|inference)\/go(?:\/v1)?$/u.test(normalized)) {
    const protocolPath = provider === 'anthropic' ? 'anthropic' : 'openai/v1';
    return `https://opencode.ai/inference/go/${protocolPath}`;
  }
  return normalized;
}
