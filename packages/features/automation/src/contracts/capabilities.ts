import type { RuntimeConfiguredModelReference, RuntimeToolDefinition, SendTurnInput } from '@setsuna-desktop/contracts';
import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { AutomationModel, AutomationProject, AutomationRun, AutomationState, AutomationTask } from './types.js';

export interface AutomationRuntimeHost {
  dataDir: string;
  now(): Date;
  id(prefix: string): string;
  reconcileConversationOwnership(state: AutomationState, instructions: string): Promise<void>;
  canReuseConversation(threadId: string): Promise<boolean>;
  createConversation(instructions: string): Promise<string>;
  createExecutionThread(task: AutomationTask): Promise<string>;
  threadExists(threadId: string): Promise<boolean>;
  resolveProject(threadId: string, projectId?: string | null): Promise<string | null>;
  listProjects(): Promise<AutomationProject[]>;
  listModels(): Promise<AutomationModel[]>;
  defaultModel(threadId: string): Promise<RuntimeConfiguredModelReference | undefined>;
  startRun(threadId: string, input: SendTurnInput): Promise<string>;
  runStatus(run: AutomationRun): Promise<Pick<AutomationRun, 'status' | 'error'>>;
}

export const automationRuntimeHostCapability = defineCapability<AutomationRuntimeHost>({ id: 'automation.runtime-host', description: 'Persistent data directory and conversation execution for local scheduled tasks' });

export interface AutomationToolService {
  startScheduler(): void;
  pendingMutationCount(): number;
  setMaintenancePaused(paused: boolean): void;
  listTools(): RuntimeToolDefinition[];
  systemPrompt(): string;
  runTool(input: unknown, threadId: string): Promise<{ content: string; preview?: string; data?: unknown }>;
}

export const automationToolServiceCapability = defineCapability<AutomationToolService>({ id: 'automation.tools', description: 'Agent tools for managing scheduled conversations' });
