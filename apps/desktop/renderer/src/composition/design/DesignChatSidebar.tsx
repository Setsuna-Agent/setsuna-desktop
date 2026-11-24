import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { designFileKey } from '@setsuna-desktop/feature-design/contracts';
import type { DesignConversation } from '@setsuna-desktop/feature-design/contracts';
import { DesignChatFullscreenContext, type DesignChatBinding, type DesignClient } from '@setsuna-desktop/feature-design/renderer';
import { Button, IconButton, SelectField, useToast } from '@setsuna-desktop/renderer-ui';
import { Archive, History, MessageCircle, SquarePen } from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DesignChatRuntime } from './DesignChatHost.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { notifyDesignConversationArchiveChanged, observeDesignConversationArchives } from '../../services/runtime-client/designConversationArchives.js';
import { DesignConversationPanel } from './DesignConversationPanel.js';

export type DesignChatProps = {
  binding: DesignChatBinding;
  conversations: NonNullable<DesignClient['conversations']>;
  project?: WorkspaceProject;
  runtime: DesignChatRuntime;
};

export default function DesignChatSidebar({ binding, conversations, project, runtime }: DesignChatProps) {
  const { t } = useI18n();
  const toast = useToast();
  const fullscreen = useContext(DesignChatFullscreenContext);
  const { ref, documentId } = binding;
  const owner = useMemo(() => ({ ref, documentId }), [ref, documentId]);
  const preference = 'design-chat:' + JSON.stringify([designFileKey(ref), documentId]);
  const [history, setHistory] = useState<DesignConversation[]>([]);
  const [selected, setSelected] = useState<string | null>();
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const version = useRef(0);
  const reload = useCallback(async () => {
    const current = ++version.current;
    try {
      const items = await conversations.list(owner);
      if (current !== version.current) return;
      setHistory(items);
      setSelected((previous) => {
        if (previous === null || items.some((item) => item.id === previous)) return previous;
        const stored = localStorage.getItem(preference);
        return items.find(({ id }) => id === stored)?.id ?? items.find((item) => !item.legacy)?.id ?? null;
      });
    } catch (error) {
      if (current !== version.current) return;
      setSelected((previous) => previous ?? null);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [conversations, owner, preference, project?.id, toast]);
  useEffect(() => {
    const refresh = () => void reload();
    refresh();
    const unsubscribe = observeDesignConversationArchives(refresh);
    return () => { ++version.current; unsubscribe(); };
  }, [reload]);
  useEffect(() => {
    if (busy && selected) localStorage.setItem(preference, selected);
  }, [busy, preference, selected]);
  const select = (id: string | null) => {
    setSelected(id);
    if (id) localStorage.setItem(preference, id);
    else localStorage.removeItem(preference);
  };
  const designChats = history.filter((item) => !item.legacy);
  const legacyChats = history.filter((item) => item.legacy);
  const historyLabel = t('feature.design.chat.history');
  const newLabel = t('feature.design.chat.new');
  const legacyLabel = t('feature.design.chat.legacy');
  const navigationDisabled = busy || archiving || selected === undefined;
  async function archiveSelected() {
    if (!selected || navigationDisabled) return;
    setArchiving(true);
    try {
      await runtime.client.updateThread(selected, { archived: true });
      ++version.current;
      setHistory((items) => items.filter(({ id }) => id !== selected));
      select(designChats.find(({ id }) => id !== selected)?.id ?? null);
      notifyDesignConversationArchiveChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setArchiving(false);
    }
  }
  const archiveButton = selected && <IconButton label={t('sidebar.archiveChat')} disabled={navigationDisabled}
    onClick={() => void archiveSelected()}><Archive size={15} /></IconButton>;
  function chatRow({ id, title, legacy }: DesignConversation) {
    const active = id === selected;
    const Icon = legacy ? History : MessageCircle;
    return <li className="design-chat-sidebar__row" key={id}>
      <Button className="design-chat-sidebar__entry" variant="ghost" size="small" title={title}
        aria-current={active ? 'true' : undefined} icon={<Icon size={15} aria-hidden="true" />}
        disabled={navigationDisabled} onClick={() => select(id)}>
        <span className="design-chat-sidebar__label">{title}</span>
      </Button>
      {active && archiveButton}
    </li>;
  }

  return <section className="design-chat-sidebar desktop-side-chat-panel" data-fullscreen={fullscreen || undefined} aria-label={t('feature.design.chat.title')}>
    {fullscreen ? <nav className="design-chat-sidebar__navigation" aria-label={historyLabel}>
      <Button className="design-chat-sidebar__new" size="small" icon={<SquarePen size={15} aria-hidden="true" />}
        title={newLabel} disabled={navigationDisabled} onClick={() => select(null)}>
        <span className="design-chat-sidebar__label">{newLabel}</span>
      </Button>
      <div className="design-chat-sidebar__conversations design-panel-scroll">
        {designChats.length ? <ul>{designChats.map(chatRow)}</ul> : null}
        {legacyChats.length ? <ul aria-label={legacyLabel}>{legacyChats.map(chatRow)}</ul> : null}
      </div>
    </nav> : <header className="design-chat-sidebar__bar">
      <SelectField className="design-chat-sidebar__history" menuClassName="design-chat-sidebar__history-menu"
        aria-label={historyLabel} menuAlign="start" menuMinWidth={192}
        disabled={navigationDisabled} value={selected ?? ''} onValueChange={(id) => select(id || null)}>
        {!selected && <option value="">{newLabel}</option>}
        {designChats.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        {legacyChats.length > 0 && <optgroup label={legacyLabel}>
          {legacyChats.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        </optgroup>}
      </SelectField>
      {archiveButton}
      <IconButton label={newLabel} disabled={navigationDisabled} onClick={() => select(null)}><SquarePen size={15} /></IconButton>
    </header>}
    {selected !== undefined && <DesignConversationPanel conversations={conversations} readOnly={archiving || legacyChats.some((item) => item.id === selected)} binding={binding} project={project} runtime={runtime} threadId={selected}
      reload={reload} onBusy={setBusy} create={async () => {
        const next = await conversations.create(owner);
        setHistory((items) => [next, ...items.filter((item) => item.id !== next.id)]);
        return next.id;
      }} onCreated={select} />}
  </section>;
}
