export const PLUGIN_UI_DOCUMENT_SCHEME = 'setsuna-plugin-ui';
export const PLUGIN_UI_DOCUMENT_CHANNELS = {
  create: 'desktop:create-plugin-ui-document',
  release: 'desktop:release-plugin-ui-document',
} as const;

export type PluginUiDocumentInput = Readonly<{ html: string; storageKey: string }>;
export type PluginUiDocument = Readonly<{ id: string; url: string }>;

export function parsePluginUiDocumentInput(value: unknown): PluginUiDocumentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plugin page.');
  const input = value as Record<string, unknown>;
  if (typeof input.html !== 'string') throw new Error('Plugin page HTML must be a string.');
  if (typeof input.storageKey !== 'string' || !input.storageKey || input.storageKey.length > 512) {
    throw new Error('Invalid plugin page storage key.');
  }
  return { html: input.html, storageKey: input.storageKey };
}
