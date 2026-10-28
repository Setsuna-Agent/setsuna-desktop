import type { ProviderConfigState } from '@setsuna-desktop/contracts';

/** A new connection owns its credentials; never retain vault presence or custom headers. */
export function copyProvider(source: ProviderConfigState, name: string): ProviderConfigState {
  return {
    ...structuredClone(source),
    id: `provider-${crypto.randomUUID()}`,
    name,
    enabled: false,
    apiKeySet: false,
    apiKeyPreview: '',
    requestHeaders: undefined,
  };
}
