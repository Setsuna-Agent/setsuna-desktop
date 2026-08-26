import type {
  RuntimeActiveTask,
  RuntimeBackgroundServiceActivity,
} from '../contracts/index.js';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';

export type RuntimeActivityLoadView = 'loading' | 'error' | 'ready';

export function resolveRuntimeActivityLoadView({
  error,
  hasSnapshot,
  loading,
}: {
  error: string | null;
  hasSnapshot: boolean;
  loading: boolean;
}): RuntimeActivityLoadView {
  if (hasSnapshot) return 'ready';
  if (loading) return 'loading';
  return error ? 'error' : 'ready';
}

export function runtimeTaskActivityKey(task: Pick<RuntimeActiveTask, 'threadId' | 'turnId'>): string {
  return `task:${task.threadId}:${task.turnId}`;
}

export function runtimeServiceActivityKey(
  service: Pick<RuntimeBackgroundServiceActivity, 'id' | 'threadId'>,
): string {
  return `service:${service.threadId}:${service.id}`;
}

export function runtimeServiceCanOpenThread(
  service: Pick<RuntimeBackgroundServiceActivity, 'threadKind' | 'threadTitle'>,
): boolean {
  return service.threadTitle !== null && runtimeActivityCanOpenThread(service);
}

export function runtimeActivityCanOpenThread(
  activity: Pick<RuntimeActiveTask, 'threadKind'>,
): boolean {
  return activity.threadKind !== 'side';
}

export function formatRuntimeActivityDuration(
  startedAt: string | null,
  nowMs: number,
  t: RendererTranslate,
): string {
  const startedAtMs = Date.parse(startedAt ?? '');
  if (!Number.isFinite(startedAtMs)) return '—';
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
  if (elapsedMinutes < 1) return t('feature.runtimeActivity.duration.lessThanMinute');
  if (elapsedMinutes < 60) {
    return t('feature.runtimeActivity.duration.minutes', { count: elapsedMinutes });
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (elapsedHours < 24) {
    return minutes
      ? t('feature.runtimeActivity.duration.hoursMinutes', { hours: elapsedHours, minutes })
      : t('feature.runtimeActivity.duration.hours', { count: elapsedHours });
  }
  const days = Math.floor(elapsedHours / 24);
  const hours = elapsedHours % 24;
  return hours
    ? t('feature.runtimeActivity.duration.daysHours', { days, hours })
    : t('feature.runtimeActivity.duration.days', { count: days });
}

export function singleLineActivityCommand(command: string, fallback: string): string {
  return command.replace(/\s+/gu, ' ').trim() || fallback;
}
