import type { RuntimeConfiguredModelReference, WorkspaceProject } from '@setsuna-desktop/contracts';

export type AutomationSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily' | 'weekdays'; time: string; timeZone: string }
  | { kind: 'weekly' | 'custom'; time: string; timeZone: string; weekdays: number[] };

export type AutomationDraft = {
  title: string;
  prompt: string;
  schedule: AutomationSchedule;
  newChat: boolean;
  /** Omitted on creation inherits the source project; null selects global chats. */
  projectId?: string | null;
  modelSelection?: RuntimeConfiguredModelReference;
  thinkingEffort?: string;
};

export type AutomationRun = {
  id: string;
  threadId: string;
  turnId?: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  error?: string;
};

export type AutomationTask = AutomationDraft & {
  id: string;
  conversationThreadId: string;
  executionThreadId?: string;
  status: 'active' | 'paused' | 'completed';
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  runs: AutomationRun[];
};

export type AutomationModel = RuntimeConfiguredModelReference & {
  name: string;
  thinkingEfforts: string[];
};

export type AutomationState = { tasks: AutomationTask[]; draftThreadId?: string };
export type AutomationProject = Pick<WorkspaceProject, 'id' | 'name' | 'path'>;
export type AutomationSnapshot = AutomationState & { models: AutomationModel[]; projects: AutomationProject[] };
