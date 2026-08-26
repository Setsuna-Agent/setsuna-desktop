import type { RuntimeTaskKind } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type {
  RuntimeActiveTask,
  RuntimeActiveTaskState,
  RuntimeBackgroundServiceActivity,
} from '../contracts/index.js';
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
import {
  formatRuntimeActivityDuration,
  runtimeActivityCanOpenThread,
  runtimeServiceActivityKey,
  runtimeServiceCanOpenThread,
  runtimeTaskActivityKey,
  singleLineActivityCommand,
} from './runtime-activity-model.js';

type RuntimeActivityRowProps = {
  nowMs: number;
  onOpenThread: (threadId: string) => void | Promise<void>;
  projectNameById: ReadonlyMap<string, string>;
  stoppingKeys: ReadonlySet<string>;
  translate: RendererTranslate;
};

export function RuntimeActiveTaskRows({
  nowMs,
  onOpenThread,
  onStopTask,
  projectNameById,
  stoppingKeys,
  tasks,
  translate: t,
}: RuntimeActivityRowProps & {
  onStopTask: (task: RuntimeActiveTask, key: string) => void | Promise<void>;
  tasks: readonly RuntimeActiveTask[];
}) {
  return (
    <div className="runtime-activity-table" role="group" aria-label={t('feature.runtimeActivity.tasks.title')}>
      <RuntimeActivityTableHeader translate={t} />
      <div className="runtime-activity-table__body">
        {tasks.map((task) => {
          const key = runtimeTaskActivityKey(task);
          const canOpenThread = runtimeActivityCanOpenThread(task);
          const stopping = stoppingKeys.has(key);
          const title = task.threadTitle || t('feature.runtimeActivity.unnamedTask');
          const projectLabel = task.projectId
            ? projectNameById.get(task.projectId) ?? t('feature.runtimeActivity.scope.project')
            : t('feature.runtimeActivity.scope.global');
          const metadata = [
            projectLabel,
            taskKindLabel(task.taskKind, t),
            task.archived ? t('feature.runtimeActivity.archived') : null,
            task.queuedInputCount
              ? t('feature.runtimeActivity.queuedCount', { count: task.queuedInputCount })
              : null,
          ].filter(Boolean).join(' · ');
          return (
            <div
              className="runtime-activity-row"
              key={key}
              onDoubleClick={canOpenThread ? () => void onOpenThread(task.threadId) : undefined}
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
              <RuntimeActivityState state={task.state} translate={t} />
              <span className="runtime-activity-row__duration">
                {formatRuntimeActivityDuration(task.startedAt, nowMs, t)}
              </span>
              <RuntimeActivityStopButton
                ariaLabel={t('feature.runtimeActivity.action.stopTask', {
                  name: title,
                })}
                stopping={stopping}
                translate={t}
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
  translate: t,
}: RuntimeActivityRowProps & {
  onStopService: (service: RuntimeBackgroundServiceActivity, key: string) => void | Promise<void>;
  services: readonly RuntimeBackgroundServiceActivity[];
}) {
  return (
    <div className="runtime-activity-table" role="group" aria-label={t('feature.runtimeActivity.services.title')}>
      <RuntimeActivityTableHeader translate={t} />
      <div className="runtime-activity-table__body">
        {services.map((service) => {
          const key = runtimeServiceActivityKey(service);
          const stopping = stoppingKeys.has(key);
          const command = singleLineActivityCommand(service.command, t('feature.runtimeActivity.services.unnamed'));
          const projectLabel = service.projectId
            ? projectNameById.get(service.projectId) ?? t('feature.runtimeActivity.scope.project')
            : t('feature.runtimeActivity.scope.global');
          const owner = service.threadTitle || t('feature.runtimeActivity.services.ownerMissing');
          const canOpenThread = runtimeServiceCanOpenThread(service);
          const metadata = [
            projectLabel,
            owner,
            service.archived ? t('feature.runtimeActivity.archived') : null,
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
                {t('feature.runtimeActivity.state.background')}
              </span>
              <span className="runtime-activity-row__duration">
                {formatRuntimeActivityDuration(service.startedAt, nowMs, t)}
              </span>
              <RuntimeActivityStopButton
                ariaLabel={t('feature.runtimeActivity.action.stopService', { name: command })}
                stopping={stopping}
                translate={t}
                onStop={() => void onStopService(service, key)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeActivityTableHeader({ translate: t }: { translate: RendererTranslate }) {
  return (
    <div className="runtime-activity-table__header" aria-hidden="true">
      <span>{t('feature.runtimeActivity.column.task')}</span>
      <span>{t('feature.runtimeActivity.column.state')}</span>
      <span>{t('feature.runtimeActivity.column.duration')}</span>
      <span>{t('feature.runtimeActivity.column.action')}</span>
    </div>
  );
}

function RuntimeActivityStopButton({
  ariaLabel,
  onStop,
  stopping,
  translate: t,
}: {
  ariaLabel: string;
  onStop: () => void;
  stopping: boolean;
  translate: RendererTranslate;
}) {
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
      <span>{t('feature.runtimeActivity.action.stop')}</span>
    </button>
  );
}

function RuntimeActivityState({
  state,
  translate: t,
}: { state: RuntimeActiveTaskState; translate: RendererTranslate }) {
  const content = state === 'waiting_for_approval'
    ? { icon: <ShieldAlert size={13} />, label: t('feature.runtimeActivity.state.waitingApproval') }
    : state === 'waiting_for_input'
      ? { icon: <MessageCircleQuestion size={13} />, label: t('feature.runtimeActivity.state.waitingInput') }
      : { icon: <LoaderCircle className="is-spinning" size={13} />, label: t('feature.runtimeActivity.state.running') };
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

function taskKindLabel(kind: RuntimeTaskKind, t: RendererTranslate): string {
  if (kind === 'goal') return t('feature.runtimeActivity.kind.goal');
  if (kind === 'review') return t('feature.runtimeActivity.kind.review');
  if (kind === 'compact') return t('feature.runtimeActivity.kind.compact');
  if (kind === 'user_shell') return t('feature.runtimeActivity.kind.userShell');
  return t('feature.runtimeActivity.kind.regular');
}
