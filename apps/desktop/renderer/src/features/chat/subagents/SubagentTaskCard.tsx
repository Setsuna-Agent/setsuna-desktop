import type {
  RuntimeCollaborationTask,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';
import { useMemo } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { AgentAvatar } from './AgentAvatar.js';
import {
  openSubagentPanel,
  spawnAgentDataFromToolRun,
} from './collaborationTaskView.js';
import { SubagentTaskStatus } from './SubagentTaskStatus.js';

/**
 * 正文中的子代理任务卡片：锚定 spawn_agent 工具运行，通过 run.data.taskId 关联
 * 父线程任务账本。账本存在时展示实时状态，缺失（例如 fork 出的历史记录）时
 * 退化为只读快照并显示为历史记录。
 */
export function SubagentTaskCard({
  run,
  task,
}: {
  run: RuntimeToolRun;
  task?: RuntimeCollaborationTask;
}) {
  const { t } = useI18n();
  const fallback = useMemo(() => spawnAgentDataFromToolRun(run), [run]);
  const identity = task?.identity ?? fallback?.identity;
  const displayName = identity?.displayName ?? t('subagent.card.unnamedAgent');
  const avatarIdentity = identity ?? { displayName, avatarSeed: run.id };
  const status = task?.status ?? (fallback?.status as RuntimeCollaborationTask['status'] | undefined) ?? 'running';
  const historical = !task;
  const handleOpen = () => {
    if (historical) return;
    openSubagentPanel(task);
  };
  return (
    <button
      type="button"
      className={`subagent-task-card${historical ? ' subagent-task-card--historical' : ''}`}
      disabled={historical}
      title={historical ? t('subagent.card.historicalTitle') : undefined}
      onClick={handleOpen}
    >
      <AgentAvatar identity={avatarIdentity} size={30} />
      <strong className="subagent-task-card__name">{displayName}</strong>
      <SubagentTaskStatus status={status} showLabel={false} />
    </button>
  );
}
