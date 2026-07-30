import type {
  RuntimeUsageResponse,
  WorkspaceEntrySearchItem,
} from '@setsuna-desktop/contracts';
import { CircleGauge, X } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { ProjectEntryCommandMenu } from './ChatCommandMenus.js';
import {
  ChatSlashCommandMenu,
  type SlashCommandMenuItem,
} from './ChatSlashCommandMenu.js';

export function ChatComposerOverlays({
  mentionMenu,
  slashMenu,
  usagePanel,
}: {
  mentionMenu: {
    activeIndex: number;
    entries: WorkspaceEntrySearchItem[];
    hasProject: boolean;
    loadError: string;
    loading: boolean;
    open: boolean;
    onHover: (index: number) => void;
    onSelect: (entry: WorkspaceEntrySearchItem) => void;
  };
  slashMenu: {
    activeIndex: number;
    items: SlashCommandMenuItem[];
    open: boolean;
    onHover: (index: number) => void;
    onSelect: (item: SlashCommandMenuItem) => void;
  };
  usagePanel: {
    open: boolean;
    threadUsage: RuntimeUsageResponse | null;
    onClose: () => void;
  };
}) {
  return (
    <>
      {mentionMenu.open ? (
        <ProjectEntryCommandMenu
          activeIndex={mentionMenu.activeIndex}
          entries={mentionMenu.entries}
          hasProject={mentionMenu.hasProject}
          loadError={mentionMenu.loadError}
          loading={mentionMenu.loading}
          onHover={mentionMenu.onHover}
          onSelect={mentionMenu.onSelect}
        />
      ) : null}
      {slashMenu.open ? (
        <ChatSlashCommandMenu
          activeIndex={slashMenu.activeIndex}
          items={slashMenu.items}
          onHover={slashMenu.onHover}
          onSelect={slashMenu.onSelect}
        />
      ) : null}
      {usagePanel.open ? (
        <ChatUsagePanel
          threadUsage={usagePanel.threadUsage}
          onClose={usagePanel.onClose}
        />
      ) : null}
    </>
  );
}

function ChatUsagePanel({
  threadUsage,
  onClose,
}: {
  threadUsage: RuntimeUsageResponse | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const summary = threadUsage?.summary;

  return (
    <section className="chat-usage-panel" aria-label={t('chat.usage.current')}>
      <header>
        <span><CircleGauge size={14} /> {t('chat.composer.usage')}</span>
        <button type="button" aria-label={t('chat.usage.close')} onClick={onClose}><X size={13} /></button>
      </header>
      <div className="chat-usage-panel__metrics">
        <span>{t('chat.usage.total')}<strong>{formatUsageTokens(summary?.totalTokens ?? 0)}</strong></span>
        <span>{t('chat.usage.input')}<strong>{formatUsageTokens(summary?.inputTokens ?? 0)}</strong></span>
        <span>{t('chat.usage.output')}<strong>{formatUsageTokens(summary?.outputTokens ?? 0)}</strong></span>
        <span>{t('chat.usage.calls')}<strong>{summary?.recordCount ?? 0}</strong></span>
      </div>
    </section>
  );
}

function formatUsageTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
