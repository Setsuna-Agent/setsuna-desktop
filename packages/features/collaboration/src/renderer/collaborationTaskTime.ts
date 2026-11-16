import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { isTerminalCollaborationTaskStatus, type CollaborationTask } from '../contracts/index.js';

export function collaborationTaskTime(
  task: CollaborationTask,
  startedAt: string,
  nowMs: number,
  translate: RendererTranslate,
): { at: string; label: string } | null {
  const active = !isTerminalCollaborationTaskStatus(task.status);
  // Resumed agents use the current execution's start, not the reusable task's creation time.
  // completedAt stays stable even when the finished result is delivered later.
  const at = active ? startedAt : task.completedAt ?? task.updatedAt;
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) return null;
  const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1_000));
  if (active) return { at, label: formatElapsed(seconds) };
  const label = seconds < 60 ? translate('feature.collaboration.time.justNow')
    : seconds < 3_600 ? translate('feature.collaboration.time.minutesAgo', { count: Math.floor(seconds / 60) })
      : seconds < 86_400 ? translate('feature.collaboration.time.hoursAgo', { count: Math.floor(seconds / 3_600) })
        : translate('feature.collaboration.time.daysAgo', { count: Math.floor(seconds / 86_400) });
  return { at, label };
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
