import type { RuntimeConfigState, RuntimeMarkdownLinkOpenMode } from '@setsuna-desktop/contracts';

export const defaultMarkdownLinkOpenMode: RuntimeMarkdownLinkOpenMode = 'in-app';

export function markdownLinkOpenModeFromConfig(
  config: Pick<RuntimeConfigState, 'desktopSettings'> | null | undefined,
): RuntimeMarkdownLinkOpenMode {
  const mode = config?.desktopSettings?.markdownLinkOpenMode;
  return mode === 'external' || mode === 'in-app' ? mode : defaultMarkdownLinkOpenMode;
}
