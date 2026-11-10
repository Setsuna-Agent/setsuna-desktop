import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown } from '@setsuna-desktop/renderer-ui';
import { ChevronRight, Clock3, MessageSquare, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { isActiveTask, type AssistantSidebarTarget, type AssistantsSnapshot } from '../contracts/index.js';
import type { AssistantSidebarActions, AssistantSidebarEntry } from './sidebar-entries.js';

const RECENT_TASK_LIMIT = 5;

/** Project work and reminders share the existing information panel and menu. */
export function AssistantTaskList({ snapshot, assistantId, scheduledThreadIds, busy, translate: t, onSelect, actions }: {
  snapshot: AssistantsSnapshot; assistantId: string; busy: boolean;
  scheduledThreadIds?: ReadonlySet<string>;
  translate: RendererTranslate; onSelect(target: AssistantSidebarTarget): void; actions: AssistantSidebarActions;
}) {
  const projects = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const entries = [
    ...snapshot.tasks.filter((task) => task.assistantId === assistantId).map((task) => ({
      entry: { assistantId, kind: 'task' as const, entryId: task.id, title: task.title, pinned: task.pinned, canDelete: !isActiveTask(task) },
      updatedAt: task.updatedAt, scheduled: scheduledThreadIds?.has(task.workThreadId) === true,
      detail: `${t(`feature.assistants.task.${task.status}`)} · ${projects.get(task.projectId) ?? task.projectId}`,
    })),
    ...snapshot.reminders.filter((reminder) => reminder.assistantId === assistantId).map((reminder) => ({
      entry: { assistantId, kind: 'reminder' as const, entryId: reminder.id, title: reminder.title, pinned: reminder.pinned, canDelete: true },
      updatedAt: reminder.updatedAt, scheduled: true,
      detail: t(`feature.assistants.reminder.${reminder.status}`) + (reminder.nextRunAt ? ` · ${new Date(reminder.nextRunAt).toLocaleString()}` : ''),
    })),
  ].sort((left, right) => Number(Boolean(right.entry.pinned)) - Number(Boolean(left.entry.pinned)) || right.updatedAt.localeCompare(left.updatedAt));
  const recent = entries.slice(0, RECENT_TASK_LIMIT);
  if (!recent.length) return null;
  return <section className="assistant-info__tasks">
    <h3>{t('feature.assistants.section.tasks')}</h3>
    <div className="assistant-info__task-list">{recent.map(({ entry, scheduled, detail }) => <TaskRow key={`${entry.kind}:${entry.entryId}`}
      entry={entry} disabled={busy} scheduled={scheduled} actions={actions} translate={t} detail={detail}
      onClick={() => onSelect(entry)} />)}</div>
  </section>;
}

function TaskRow({ entry, detail, disabled, scheduled, actions, translate: t, onClick }: {
  entry: AssistantSidebarEntry; detail: string; disabled: boolean; scheduled: boolean;
  actions: AssistantSidebarActions; translate: RendererTranslate; onClick(): void;
}) {
  const Icon = scheduled ? Clock3 : MessageSquare;
  return <Dropdown trigger={['contextMenu']} disabled={disabled} menu={{ items: [
    { key: 'rename', label: t('feature.assistants.sidebar.rename'), icon: <Pencil size={15} />, onClick: () => actions.onRename(entry) },
    { key: 'pin', label: t(entry.pinned ? 'feature.assistants.sidebar.unpin' : 'feature.assistants.sidebar.pin'),
      icon: entry.pinned ? <PinOff size={15} /> : <Pin size={15} />, onClick: () => actions.onTogglePin(entry) },
    { type: 'divider' },
    { key: 'delete', label: t('feature.assistants.sidebar.delete'), icon: <Trash2 size={15} />, danger: true,
      disabled: !entry.canDelete, onClick: () => actions.onDelete(entry) },
  ] }}>
    <button type="button" className="assistant-task-row" title={`${entry.title}\n${detail}`} disabled={disabled} onClick={onClick}>
      <Icon size={14} className="assistant-task-row__icon" aria-hidden="true" />
      <span className="assistant-task-row__title">{entry.title}</span>
      {entry.pinned ? <Pin size={12} className="assistant-task-row__pin" aria-hidden="true" /> : null}
      <ChevronRight size={12} className="assistant-task-row__open" aria-hidden="true" />
    </button>
  </Dropdown>;
}
