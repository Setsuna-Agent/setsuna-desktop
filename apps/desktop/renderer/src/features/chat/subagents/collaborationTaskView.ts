import type {
  RuntimeAgentIdentity,
  RuntimeCollaborationTask,
  RuntimeThreadSummary,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';

/** 主对话线程 = 非 side 且无 parentThreadId；左侧栏、搜索结果与归档列表统一使用该判断。 */
export function isPrimaryConversationThread(thread: RuntimeThreadSummary): boolean {
  return thread.kind !== 'side' && !thread.parentThreadId;
}

export type SpawnAgentToolRunData = {
  taskId?: string;
  childThreadId?: string;
  title?: string;
  objective?: string;
  identity?: RuntimeAgentIdentity;
  status?: string;
};

/** 从 spawn_agent 的 tool.completed data 中恢复任务快照；账本缺失时作为卡片兜底。 */
export function spawnAgentDataFromToolRun(run: RuntimeToolRun): SpawnAgentToolRunData | null {
  const data = run.data;
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (record.tool !== 'spawn_agent') return null;
  return {
    ...(typeof record.taskId === 'string' ? { taskId: record.taskId } : {}),
    ...(typeof record.childThreadId === 'string' ? { childThreadId: record.childThreadId } : {}),
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.objective === 'string' ? { objective: record.objective } : {}),
    ...(isAgentIdentity(record.identity) ? { identity: record.identity } : {}),
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
  };
}

export function isAgentIdentity(value: unknown): value is RuntimeAgentIdentity {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as RuntimeAgentIdentity).displayName === 'string'
    && typeof (value as RuntimeAgentIdentity).avatarSeed === 'string',
  );
}

/** 打开协作任务右侧只读面板；由 workspace panel 层注册实现，避免贯穿多层 props。 */
export type SubagentPanelOpener = (task: RuntimeCollaborationTask) => void;

let registeredSubagentPanelOpener: SubagentPanelOpener | null = null;

export function registerSubagentPanelOpener(opener: SubagentPanelOpener | null): void {
  registeredSubagentPanelOpener = opener;
}

export function openSubagentPanel(task: RuntimeCollaborationTask): void {
  registeredSubagentPanelOpener?.(task);
}
