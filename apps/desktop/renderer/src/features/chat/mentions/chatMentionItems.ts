import { designFileKey, type ProjectDesignEntry } from '@setsuna-desktop/feature-design/contracts';
import type { RuntimeThread, WorkspaceProject, WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { isBrowserTabReference, type BrowserPanelDescriptor, type BrowserTabReference } from '@setsuna-desktop/feature-browser/contracts';
import type { PluginAppCandidate } from '../../../kernel/declarative-plugin-ui/app-appearance/usePluginAppCatalog.js';

/** Favicon data is local presentation state, separate from the serialized model reference. */
export type BrowserTabMentionCandidate = BrowserTabReference & { faviconUrl?: string | null };

export type ChatMentionItem =
  | { kind: 'design'; owner: ProjectDesignEntry }
  | { kind: 'app'; app: PluginAppCandidate }
  | { kind: 'browser-tab'; tab: BrowserTabMentionCandidate }
  | { kind: 'workspace'; entry: WorkspaceEntrySearchItem };

/** Project designs follow logical conversation ownership even when file mentions search a worktree. */
export function chatDesignProjectId(thread: RuntimeThread | null, project?: WorkspaceProject) {
  return thread ? (thread.featureId ? undefined : thread.projectId) : project?.id;
}

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
  designs: readonly ProjectDesignEntry[] = [],
): ChatMentionItem[] {
  const search = query.trim().toLowerCase();
  return [
    ...designs.filter(({ ref, directory }) => !search || ref.path.toLowerCase().includes(search) || directory?.toLowerCase().includes(search))
      .map((owner): ChatMentionItem => ({ kind: 'design', owner })),
    ...apps.filter((app) => !search || `${app.name}\n${app.pluginId}`.toLowerCase().includes(search))
      .map((app): ChatMentionItem => ({ kind: 'app', app })),
    ...tabs.filter((tab) => !search || `${tab.title}\n${tab.url}`.toLowerCase().includes(search))
      .map((tab): ChatMentionItem => ({ kind: 'browser-tab', tab })),
    ...entries.map((entry): ChatMentionItem => ({ kind: 'workspace', entry })),
  ];
}

export function chatMentionItemKey(item: ChatMentionItem): string {
  if (item.kind === 'design') return 'design:' + designFileKey(item.owner.ref);
  if (item.kind === 'app') return `app:${JSON.stringify([item.app.pluginId, item.app.contributionId])}`;
  return item.kind === 'browser-tab' ? `browser:${item.tab.id}` : `${item.entry.rootId ?? ''}:${item.entry.kind}:${item.entry.path}`;
}
