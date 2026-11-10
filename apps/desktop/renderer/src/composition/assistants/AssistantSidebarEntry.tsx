import { AssistantContextMenu, AssistantEditor, useAssistantDeletion, useAssistantsSnapshot, type AssistantsRendererService } from '@setsuna-desktop/feature-assistants/renderer';
import { Button, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { UserRoundPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { AssistantAvatar, assistantsHostUi } from './AssistantsHostUi.js';
import { useAssistantsFeature } from './AssistantsFeatureBoundary.js';

type EntryProps = { activeThreadId?: string | null; onOpenConversation(destination: () => Promise<string>): Promise<boolean> };

export function AssistantSidebarEntry(props: EntryProps) {
  const service = useAssistantsFeature();
  return service ? <Entry {...props} service={service} /> : null;
}

function Entry({ service, activeThreadId, onOpenConversation }: EntryProps & { service: AssistantsRendererService }) {
  const { t } = useI18n();
  const snapshot = useAssistantsSnapshot(service.store);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  const mounted = useRef(false);
  const deletion = useAssistantDeletion({ client: service.client, translate: t, onDeleted: async () => {
    setEditing(false);
    await service.store.refresh();
  }, onError: setError });
  // This release exposes one configuration. Keep older identities in storage untouched.
  const assistant = snapshot?.assistants[0];
  const conversation = snapshot?.conversations.find((item) => item.assistantId === assistant?.id);
  const active = Boolean(activeThreadId && (activeThreadId === conversation?.threadId || conversation?.previousThreadIds?.includes(activeThreadId)));
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void service.store.refresh(abort.signal).catch(() => undefined);
    return () => { mounted.current = false; abort.abort(); };
  }, [service]);

  const open = async (assistantId: string) => {
    setOpening(true); setError(null);
    try {
      await onOpenConversation(async () => {
        const { threadId } = await service.client.openConversation(assistantId);
        await service.store.refresh();
        return threadId;
      });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setOpening(false); }
  };
  if (!snapshot) return null;
  const busy = opening || deletion.busy;
  return <div className="desktop-agent-sidebar__assistants" role="group" aria-label={t('feature.assistants.title')}>
    {assistant ? <AssistantContextMenu translate={t} disabled={busy} onEdit={() => setEditing(true)} onDelete={() => void deletion.remove(assistant.id)}>
      <Button variant="ghost" className={`desktop-agent-command ${active ? 'is-active' : ''}`} type="button" disabled={busy}
        aria-current={active || undefined} onClick={() => void open(assistant.id)}>
        <AssistantAvatar assistant={assistant} size="inline" className="desktop-agent-command__avatar desktop-icon-avatar--glyph" />
        <span className="desktop-agent-command__label">{assistant.name}</span>
      </Button>
    </AssistantContextMenu> : <Button variant="ghost" className="desktop-agent-command" type="button" onClick={() => setEditing(true)}>
      <UserRoundPlus className="desktop-agent-command__icon" size={15} /><span className="desktop-agent-command__label">{t('feature.assistants.create')}</span>
    </Button>}
    <ToastNotice message={error} />
    {editing ? <AssistantEditor key={assistant?.id ?? 'new'} assistant={assistant} snapshot={snapshot} service={service} ui={assistantsHostUi} translate={t}
      onClose={() => setEditing(false)} onDeleted={async () => { setEditing(false); await service.store.refresh(); }}
      onSaved={(saved) => {
        setEditing(false);
        if (!assistant) void open(saved.id);
        else void service.store.refresh().catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); });
      }} /> : null}
  </div>;
}
