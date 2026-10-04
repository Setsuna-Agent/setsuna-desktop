import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { isBrowserTabReference, type BrowserPanelDescriptor, type BrowserTabReference } from '@setsuna-desktop/feature-browser/contracts';
import type { PluginAppCandidate } from '../../../kernel/declarative-plugin-ui/app-appearance/usePluginAppCatalog.js';

/** Favicon data is local presentation state, separate from the serialized model reference. */
export type BrowserTabMentionCandidate = BrowserTabReference & { faviconUrl?: string | null };

export type ChatMentionItem =
  | { kind: 'app'; app: PluginAppCandidate }
  | { kind: 'browser-tab'; tab: BrowserTabMentionCandidate }
  | { kind: 'workspace'; entry: WorkspaceEntrySearchItem };

export function browserTabReferences(panels: readonly BrowserPanelDescriptor[]): BrowserTabMentionCandidate[] {
  return panels.flatMap((panel) => {
    const tab = { id: panel.id, title: panel.title ?? '', url: panel.browser?.url ?? '' };
    // The internal home page has no browser guest for the model to inspect.
    return isBrowserTabReference(tab) ? [{ ...tab, faviconUrl: panel.browser?.faviconUrl ?? null }] : [];
  });
}

export function chatMentionItems(
  tabs: readonly BrowserTabMentionCandidate[],
  entries: readonly WorkspaceEntrySearchItem[],
  query: string,
  apps: readonly PluginAppCandidate[] = [],
): ChatMentionItem[] {
  const search = query.trim().toLowerCase();
  return [
    ...apps.filter((app) => !search || `${app.name}\n${app.pluginId}`.toLowerCase().includes(search))
      .map((app): ChatMentionItem => ({ kind: 'app', app })),
    ...tabs.filter((tab) => !search || `${tab.title}\n${tab.url}`.toLowerCase().includes(search))
      .map((tab): ChatMentionItem => ({ kind: 'browser-tab', tab })),
    ...entries.map((entry): ChatMentionItem => ({ kind: 'workspace', entry })),
  ];
}

export function chatMentionItemKey(item: ChatMentionItem): string {
  if (item.kind === 'app') return `app:${JSON.stringify([item.app.pluginId, item.app.contributionId])}`;
  return item.kind === 'browser-tab' ? `browser:${item.tab.id}` : `${item.entry.kind}:${item.entry.path}`;
}
