import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { ToastNotice, Tooltip } from '@setsuna-desktop/renderer-ui';
import type { Assistant, AssistantReminder, AssistantTask, AssistantsSnapshot } from '../contracts/index.js';
import type { AssistantsRendererService } from './client.js';
import type { AssistantsHostUi } from './host.js';
import { AssistantConnectionDot } from './AssistantConnectionDot.js';
import { AssistantTaskList } from './AssistantTaskList.js';
import { AssistantEntryRenameDialog } from './AssistantEntryRenameDialog.js';
import { AssistantReminderDialog } from './AssistantReminderDialog.js';
import { useAssistantSidebarActions } from './useAssistantSidebarActions.js';

export function AssistantInfoPanel({ assistant, snapshot, service, ui, scheduledThreadIds, translate: t, onOpenTask, onOpenReminder }: {
  assistant: Assistant; snapshot: AssistantsSnapshot; service: AssistantsRendererService; ui: AssistantsHostUi;
  scheduledThreadIds?: ReadonlySet<string>;
  translate: RendererTranslate; onOpenTask(task: AssistantTask): void; onOpenReminder(reminder: AssistantReminder): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [reminderId, setReminderId] = useState<string | null>(null);
  // Keep only the selection; polling remains the source of reminder details and run receipts.
  const reminder = snapshot.reminders.find((item) => item.assistantId === assistant.id && item.id === reminderId);
  const actions = useAssistantSidebarActions({ service, translate: t, onError: setError, deleteEntry: async (target) => {
    await service.client.deleteSidebarEntry(target);
    if (target.kind === 'reminder') setReminderId((current) => current === target.entryId ? null : current);
    await service.store.refresh();
  } });
  const connector = snapshot.connectors.find((item) => item.assistantId === assistant.id);
  const connectionState = connector?.state ?? 'disabled';
  const connectionLabel = `QQ · ${t(`feature.assistants.connector.${connectionState}`)}`;
  return <section className="assistant-info" aria-label={t('feature.assistants.info')}>
    <header className="assistant-info__identity">
      <Tooltip title={connector?.error ? `${connectionLabel} · ${connector.error}` : connectionLabel}>
        <span className="assistant-info__presence" role="img" aria-label={connectionLabel} tabIndex={0}>
          <ui.Avatar assistant={assistant} size="menu" className="assistant-info__avatar" />
          <AssistantConnectionDot state={connectionState} />
        </span>
      </Tooltip>
      <h2 className="assistant-info__name" title={assistant.name}>{assistant.name}</h2>
    </header>
    <AssistantTaskList snapshot={snapshot} assistantId={assistant.id} scheduledThreadIds={scheduledThreadIds} busy={actions.busy} translate={t} actions={actions}
      onSelect={({ kind, entryId }) => {
        if (kind === 'reminder') {
          setReminderId(entryId);
        } else {
          const task = snapshot.tasks.find((item) => item.id === entryId);
          if (task) onOpenTask(task);
        }
      }} />
    {reminder ? <AssistantReminderDialog reminder={reminder} busy={actions.busy} translate={t}
      onClose={() => setReminderId(null)}
      onOpenLastRun={() => { setReminderId(null); onOpenReminder(reminder); }}
      onDelete={() => actions.onDelete({ assistantId: assistant.id, kind: 'reminder', entryId: reminder.id,
        title: reminder.title, canDelete: true })} /> : null}
    <ToastNotice message={error} />
    {actions.rename ? <AssistantEntryRenameDialog title={actions.rename.title} busy={actions.busy} translate={t}
      onChange={actions.changeTitle} onSave={actions.saveRename} onClose={actions.closeRename} /> : null}
  </section>;
}
