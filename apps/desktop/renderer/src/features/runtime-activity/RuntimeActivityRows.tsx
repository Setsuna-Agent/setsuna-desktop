import type {
  RuntimeActiveTask,
  RuntimeActiveTaskState,
  RuntimeBackgroundServiceActivity,
  RuntimeTaskKind,
} from '@setsuna-desktop/contracts';
import {
  Bot,
  FileSearch,
  Layers3,
  LoaderCircle,
  MessageCircleQuestion,
  Radio,
  ShieldAlert,
  Target,
  Terminal,
} from 'lucide-react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import {
  formatRuntimeActivityDuration,
  runtimeServiceActivityKey,
  runtimeServiceCanOpenThread,
  runtimeTaskActivityKey,
  singleLineActivityCommand,
} from './runtimeActivityModel.js';

type RuntimeActivityRowProps = {
  nowMs: number;
  onOpenThread: (threadId: string) => void | Promise<void>;
  projectNameById: ReadonlyMap<string, string>;
  stoppingKeys: ReadonlySet<string>;
};

export function RuntimeActiveTaskRows({
  nowMs,
  onOpenThread,
  onStopTask,
  projectNameById,
  stoppingKeys,
  tasks,
}: RuntimeActivityRowProps & {
  onStopTask: (task: RuntimeActiveTask, key: string) => void | Promise<void>;
  tasks: RuntimeActiveTask[];
}) {
  const { t } = useI18n();
  return (
    <div className="runtime-activity-table" role="group" aria-label={t('runtimeActivity.tasks.title')}>
      <RuntimeActivityTableHeader />
      <div className="runtime-activity-table__body">
        {tasks.map((task) => {
          const key = runtimeTaskActivityKey(task);
          const stopping = stoppingKeys.has(key);
          const title = task.threadTitle || t('runtimeActivity.unnamedTask');
          const projectLabel = task.projectId
            ? projectNameById.get(task.projectId) ?? t('runtimeActivity.scope.project')
            : t('runtimeActivity.scope.global');
          const metadata = [
            projectLabel,
            taskKindLabel(task.taskKind, t),
            task.archived ? t('runtimeActivity.archived') : null,
            task.queuedInputCount
              ? t('runtimeActivity.queuedCount', { count: task.queuedInputCount })
              : null,
          ].filter(Boolean).join(' · ');
          return (
            <div
              className="runtime-activity-row"
              key={key}
              onDoubleClick={() => void onOpenThread(task.threadId)}
            >
              <span className="runtime-activity-row__identity">
                <span className="runtime-activity-row__icon" aria-hidden="true">
                  <TaskKindIcon kind={task.taskKind} />
                </span>
                <span className="runtime-activity-row__copy">
                  <strong title={task.threadTitle || title}>{title}</strong>
                  <small title={metadata}>{metadata}</small>
                </span>
              </span>
              <RuntimeActivityState state={task.state} />
              <span className="runtime-activity-row__duration">
                {formatRuntimeActivityDuration(task.startedAt, nowMs, t)}
              </span>
              <RuntimeActivityStopButton
                ariaLabel={t('runtimeActivity.action.stopTask', {
                  name: title,
                })}
                stopping={stopping}
                onStop={() => void onStopTask(task, key)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RuntimeBackgroundServiceRows({
  nowMs,
  onOpenThread,
  onStopService,
  projectNameById,
  services,
  stoppingKeys,
}: RuntimeActivityRowProps & {
  onStopService: (service: RuntimeBackgroundServiceActivity, key: string) => void | Promise<void>;
  services: RuntimeBackgroundServiceActivity[];
}) {
  const { t } = useI18n();
  return (
    <div className="runtime-activity-table" role="group" aria-label={t('runtimeActivity.services.title')}>
      <RuntimeActivityTableHeader />
      <div className="runtime-activity-table__body">
        {services.map((service) => {
          const key = runtimeServiceActivityKey(service);
          const stopping = stoppingKeys.has(key);
          const command = singleLineActivityCommand(service.command, t('runtimeActivity.services.unnamed'));
          const projectLabel = service.projectId
            ? projectNameById.get(service.projectId) ?? t('runtimeActivity.scope.project')
            : t('runtimeActivity.scope.global');
          const owner = service.threadTitle || t('runtimeActivity.services.ownerMissing');
          const canOpenThread = runtimeServiceCanOpenThread(service);
          const metadata = [
            projectLabel,
            owner,
            service.archived ? t('runtimeActivity.archived') : null,
          ].filter(Boolean).join(' · ');
          return (
            <div
              className="runtime-activity-row"
              key={key}
              onDoubleClick={canOpenThread ? () => void onOpenThread(service.threadId) : undefined}
            >
              <span className="runtime-activity-row__identity">
                <span className="runtime-activity-row__icon" aria-hidden="true">
                  <Terminal size={15} />
                </span>
                <span className="runtime-activity-row__copy">
                  <strong title={service.command}>{command}</strong>
                  <small title={`${metadata} · ${service.directory}`}>{metadata}</small>
                </span>
              </span>
              <span className="runtime-activity-row__state runtime-activity-row__state--service">
                <Radio size={13} aria-hidden="true" />
                {t('runtimeActivity.state.background')}
              </span>
              <span className="runtime-activity-row__duration">
                {formatRuntimeActivityDuration(service.startedAt, nowMs, t)}
              </span>
              <RuntimeActivityStopButton
                ariaLabel={t('runtimeActivity.action.stopService', { name: command })}
                stopping={stopping}
                onStop={() => void onStopService(service, key)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeActivityTableHeader() {
  const { t } = useI18n();
  return (
    <div className="runtime-activity-table__header" aria-hidden="true">
      <span>{t('runtimeActivity.column.task')}</span>
      <span>{t('runtimeActivity.column.state')}</span>
      <span>{t('runtimeActivity.column.duration')}</span>
      <span>{t('runtimeActivity.column.action')}</span>
    </div>
  );
}

function RuntimeActivityStopButton({
  ariaLabel,
  onStop,
  stopping,
}: {
  ariaLabel: string;
  onStop: () => void;
  stopping: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      aria-label={ariaLabel}
      className="runtime-activity-row__action"
      disabled={stopping}
      title={ariaLabel}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onStop();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {stopping ? <LoaderCircle className="is-spinning" size={12} aria-hidden="true" /> : null}
      <span>{t('runtimeActivity.action.stop')}</span>
    </button>
  );
}

function RuntimeActivityState({ state }: { state: RuntimeActiveTaskState }) {
  const { t } = useI18n();
  const content = state === 'waiting_for_approval'
    ? { icon: <ShieldAlert size={13} />, label: t('runtimeActivity.state.waitingApproval') }
    : state === 'waiting_for_input'
      ? { icon: <MessageCircleQuestion size={13} />, label: t('runtimeActivity.state.waitingInput') }
      : { icon: <LoaderCircle className="is-spinning" size={13} />, label: t('runtimeActivity.state.running') };
  return (
    <span className={`runtime-activity-row__state runtime-activity-row__state--${state}`}>
      {content.icon}
      {content.label}
    </span>
  );
}

function TaskKindIcon({ kind }: { kind: RuntimeTaskKind }) {
  if (kind === 'goal') return <Target size={15} />;
  if (kind === 'review') return <FileSearch size={15} />;
  if (kind === 'compact') return <Layers3 size={15} />;
  if (kind === 'user_shell') return <Terminal size={15} />;
  return <Bot size={15} />;
}

function taskKindLabel(kind: RuntimeTaskKind, t: Translate): string {
  if (kind === 'goal') return t('runtimeActivity.kind.goal');
  if (kind === 'review') return t('runtimeActivity.kind.review');
  if (kind === 'compact') return t('runtimeActivity.kind.compact');
  if (kind === 'user_shell') return t('runtimeActivity.kind.userShell');
  return t('runtimeActivity.kind.regular');
}
