import { normalizeProviderRequestHeaders } from '@setsuna-desktop/contracts';
import type { Provider } from '@earendil-works/pi-ai';
import { defaultProviderRequestHeaders, type ModelProviderRuntimeConfig } from '../contracts/index.js';
import { builtinCatalogProviderIdForConfig } from './provider-catalog.js';

/** User configuration wins over presets and SDK defaults on every provider request. */
export function applyProviderRequestHeaders(
  headers: Headers,
  provider: Pick<ModelProviderRuntimeConfig, 'provider' | 'baseUrl' | 'catalogProviderId' | 'requestHeaders'>,
  context: Readonly<{ appVersion: string; sessionId?: string }>,
  providers?: readonly Provider[],
): void {
  const defaults = defaultProviderRequestHeaders(builtinCatalogProviderIdForConfig(provider, providers));
  const templates = normalizeProviderRequestHeaders(provider.requestHeaders) ?? defaults;
  // Pi also adds session headers. Clear the preset ones first so removing them in
  // user configuration still disables them, then apply the chosen templates below.
  for (const [name, template] of Object.entries(defaults)) {
    if (template.includes('{{sessionId}}')) headers.delete(name);
  }
  for (const [name, template] of Object.entries(templates)) {
    // Model discovery has no conversation. Never send a literal placeholder or invent a session.
    if (template.includes('{{sessionId}}') && !context.sessionId) {
      headers.delete(name);
      continue;
    }
    headers.set(name, template.replace(/\{\{(appVersion|sessionId)\}\}/gu, (_match, key: keyof typeof context) => context[key] ?? ''));
  }
}
