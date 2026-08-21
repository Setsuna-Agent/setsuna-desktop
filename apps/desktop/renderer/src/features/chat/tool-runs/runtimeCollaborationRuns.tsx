import type { RuntimeCollaborationTask, RuntimeToolRun } from '@setsuna-desktop/contracts';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import { SubagentTaskCard } from '../subagents/SubagentTaskCard.js';

/** spawn_agent 聚合摘要：优先展示任务名，缺失时回退到通用文案。 */
export function collaborationGroupSummary(runs: RuntimeToolRun[], t: Translate): string {
  const run = runs[0];
  const name = run ? collaborationRunDisplayName(run) : '';
  if (name) return name;
  return t('toolRun.collaboration.spawned');
}

export function collaborationRunDisplayName(run: RuntimeToolRun): string {
  const data = run.data;
  if (!data || typeof data !== 'object') return '';
  const identity = (data as { identity?: { displayName?: unknown } }).identity;
  if (identity && typeof identity.displayName === 'string' && identity.displayName.trim()) {
    return identity.displayName;
  }
  const title = (data as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title : '';
}

export function spawnChildThreadId(run: RuntimeToolRun): string | undefined {
  const data = run.data;
  if (!data || typeof data !== 'object') return undefined;
  const childThreadId = (data as { childThreadId?: unknown }).childThreadId;
  return typeof childThreadId === 'string' ? childThreadId : undefined;
}

/**
 * 正文中的 spawn_agent 工具运行渲染为一张子代理任务卡片；多个 spawn 之间
 * 每项独立成卡，并通过账本任务实时同步状态。
 */
export function SubagentToolRunCard({
  run,
  collaborationTasks,
}: {
  run: RuntimeToolRun;
  collaborationTasks?: RuntimeCollaborationTask[];
}) {
  const task = collaborationTasks?.find(
    (candidate) => candidate.childThreadId === spawnChildThreadId(run),
  );
  return <SubagentTaskCard run={run} task={task} />;
}
