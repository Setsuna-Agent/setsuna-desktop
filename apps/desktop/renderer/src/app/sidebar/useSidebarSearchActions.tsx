import { rendererPluginViewKey, shellPluginPageSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { settingsPageSlot } from '@setsuna-desktop/renderer-contracts/settings';
import { Blocks, Bot, Clock3, FolderPlus, GitPullRequest, MessageCircle, PenTool, Settings, SquarePen } from 'lucide-react';
import { usePluginManagementFeatureSnapshot } from '../../composition/PluginManagementFeatureBoundary.js';
import { usePluginAppCatalog } from '../../kernel/declarative-plugin-ui/app-appearance/usePluginAppCatalog.js';
import { useRendererOwnedKeyedEntries } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import { PresetAvatar } from '../../shared/ui/icon-avatars/PresetAvatar.js';
import type { SidebarSearchAction } from './sidebarSearchTypes.js';

export type SidebarSearchActionHandlers = {
  onNewChat(): void | Promise<unknown>;
  onAddProject(): void;
  onOpenChat(): void;
  onOpenDesign(): void;
  onOpenAssistant?: () => void | Promise<unknown>;
  onOpenAutomation(): void;
  onOpenCapabilities(): void;
  onOpenPullRequests(): void;
  onOpenPlugin(viewKey: string): void;
  onOpenSettings(sectionId: string): void;
};

/** Read existing navigation contributions, so added settings and renamed apps remain searchable. */
export function useSidebarSearchActions(handlers: SidebarSearchActionHandlers): SidebarSearchAction[] {
  const { t } = useI18n();
  const { plugins } = usePluginManagementFeatureSnapshot();
  const apps = usePluginAppCatalog(plugins);
  const pages = useRendererOwnedKeyedEntries(settingsPageSlot);
  const activeApps = useRendererOwnedKeyedEntries(shellPluginPageSlot);
  const actions: SidebarSearchAction[] = [
    { id: 'new-chat', title: t('sidebar.newChat'), keywords: 'new chat', icon: <SquarePen size={15} />, shortcut: 'app.newChat', run: handlers.onNewChat },
    { id: 'add-project', title: t('sidebar.createProject'), keywords: 'open folder project', icon: <FolderPlus size={15} />, shortcut: 'app.addProject', run: handlers.onAddProject },
    { id: 'chat', title: t('sidebar.chats'), keywords: 'chat', icon: <MessageCircle size={15} />, shortcut: 'app.openChat', run: handlers.onOpenChat },
    { id: 'design', title: t('search.openDesign'), keywords: '打开设计 设计稿 画布 open design canvas', icon: <PenTool size={15} />, run: handlers.onOpenDesign },
    { id: 'automation', title: t('feature.automation.title'), keywords: '自动化 automation schedule', icon: <Clock3 size={15} />, shortcut: 'app.openAutomation', run: handlers.onOpenAutomation },
    { id: 'plugins', title: t('sidebar.plugins'), keywords: 'plugins capabilities', icon: <Blocks size={15} />, shortcut: 'app.openCapabilities', run: handlers.onOpenCapabilities },
    { id: 'pull-requests', title: 'Pull Request', keywords: 'pr 拉取请求', icon: <GitPullRequest size={15} />, shortcut: 'app.openPullRequests', run: handlers.onOpenPullRequests },
  ];
  if (handlers.onOpenAssistant) actions.splice(2, 0, {
    id: 'assistant', title: t('feature.assistants.title'), keywords: '助理 助手 assistant', icon: <Bot size={15} />, shortcut: 'app.openAssistant', run: handlers.onOpenAssistant,
  });
  for (const app of apps) {
    const viewKey = rendererPluginViewKey(app.pluginId, app.contributionId);
    if (!activeApps.some((entry) => entry.key === viewKey)) continue;
    actions.push({ id: `app:${viewKey}`, title: app.name, keywords: app.pluginId,
      icon: <PresetAvatar avatar={app.avatar} color={app.avatarColor} />, run: () => handlers.onOpenPlugin(viewKey) });
  }
  for (const page of pages.filter((entry) => entry.metadata.location === 'settings').sort((a, b) => a.metadata.order - b.metadata.order)) {
    const Icon = page.metadata.icon ?? Settings;
    const title = t(page.metadata.titleKey as MessageKey | `feature.${string}`);
    actions.push({ id: `settings:${page.key}`, title: `${t('settings.title')} · ${title}`,
      keywords: `settings ${page.metadata.sectionId}`, icon: <Icon size={15} />,
      run: () => handlers.onOpenSettings(page.metadata.sectionId) });
  }
  return actions;
}

export function filterSidebarSearchActions(actions: SidebarSearchAction[], query: string): SidebarSearchAction[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return actions;
  return actions.map((action) => ({ action, rank: action.title.toLocaleLowerCase().startsWith(keyword) ? 0
    : action.title.toLocaleLowerCase().includes(keyword) ? 1 : 2 }))
    .filter(({ action }) => `${action.title} ${action.keywords ?? ''}`.toLocaleLowerCase().includes(keyword))
    .sort((a, b) => a.rank - b.rank).map(({ action }) => action);
}
