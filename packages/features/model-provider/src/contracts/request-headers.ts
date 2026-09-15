import type { ProviderRequestHeaders } from '@setsuna-desktop/contracts';

const OPENCODE_GO_HEADERS: Readonly<ProviderRequestHeaders> = Object.freeze({
  'user-agent': 'setsuna-desktop/{{appVersion}}',
  'x-opencode-session': '{{sessionId}}',
});
const EMPTY_HEADERS: Readonly<ProviderRequestHeaders> = Object.freeze({});

/** Shared preset templates keep the editor and transport defaults identical. */
export function defaultProviderRequestHeaders(catalogProviderId?: string | null): Readonly<ProviderRequestHeaders> {
  return catalogProviderId === 'opencode-go' ? OPENCODE_GO_HEADERS : EMPTY_HEADERS;
}
