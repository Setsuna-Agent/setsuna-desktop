import type {
  RuntimeApprovalRequest, RuntimeConfiguredModelReference, RuntimeInterfaceLanguage, RuntimeToolDefinition, StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { AssistantModel, AssistantProject } from './types.js';

export type AssistantThreadInfo = {
  id: string;
  title: string;
  projectId?: string;
  /** Threads sharing this key operate on the same checkout. */
  workspaceKey: string;
  /** Feature-owned and side conversations are never exposed to assistants as project history. */
  featureOwned: boolean;
  archived: boolean;
  activeTurnId?: string;
  updatedAt: string;
};

export type AssistantThreadMessage = { role: 'user' | 'assistant'; content: string; createdAt: string };

export type AssistantTurnOutcome = {
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'missing';
  error?: string;
  /** Visible final answer of the turn, when it produced one. */
  finalAnswer?: string;
};

export type AssistantTurnStart = { turnId?: string; queuedInputId?: string };

/** Where a submitted input is now; inputs are tracked by their clientId so steering and restarts stay traceable. */
export type AssistantInputLocation = { state: 'queued' } | { state: 'started'; turnId: string } | { state: 'missing' };

export type AssistantRequestAnswer = {
  decision?: 'approve' | 'approve_for_session' | 'reject';
  action?: 'submit' | 'decline';
  values?: Record<string, string | number | boolean | string[]>;
  message?: string;
};

/** Minimal WebSocket surface shared by Node's global WebSocket and test doubles. */
export type AssistantWebSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

/**
 * Core services the assistants Feature needs. Threads, turns, queues, approvals and events stay
 * owned by Core; this Feature only keeps the relationships between them.
 */
export interface AssistantsRuntimeHost {
  dataDir: string;
  now(): Date;
  id(prefix: string): string;
  listProjects(): Promise<AssistantProject[]>;
  listModels(): Promise<AssistantModel[]>;
  createConversation(input: { title: string; modelSelection?: RuntimeConfiguredModelReference }): Promise<string>;
  updateConversationModel(threadId: string, modelSelection: RuntimeConfiguredModelReference | undefined): Promise<void>;
  /** Copies missing history and archives the original; false defers while either transcript is busy. */
  mergeConversationHistory(sourceThreadId: string, destinationThreadId: string): Promise<boolean>;
  deleteThread(threadId: string, options?: { onlyIfIdle?: boolean }): Promise<void>;
  /** Title and recency of every assistant conversation, for the assistant page. */
  listConversationSummaries(): Promise<{ id: string; title: string; updatedAt: string; activeTurnId?: string }[]>;
  getThreadInfo(threadId: string): Promise<AssistantThreadInfo | null>;
  searchThreads(input: { projectIds: readonly string[]; query?: string; limit: number }): Promise<AssistantThreadInfo[]>;
  readThreadMessages(threadId: string, limit: number): Promise<AssistantThreadMessage[]>;
  /** New project conversations use the project's default model and Skills. */
  createWorkThread(input: { title: string; projectId: string; worktree: boolean; taskId: string; modelSelection?: RuntimeConfiguredModelReference }): Promise<AssistantThreadInfo>;
  startTurn(threadId: string, input: { input: string; clientId?: string; modelSelection?: RuntimeConfiguredModelReference; thinkingEffort?: string }): Promise<AssistantTurnStart>;
  steerTurn(threadId: string, turnId: string, input: string): Promise<void>;
  cancelTurn(threadId: string, turnId: string): Promise<void>;
  deleteQueuedInput(threadId: string, inputId: string): Promise<boolean>;
  locateInput(threadId: string, input: { clientId: string; queuedInputId?: string }): Promise<AssistantInputLocation>;
  turnOutcome(threadId: string, turnId: string): Promise<AssistantTurnOutcome>;
  listApprovals(): Promise<RuntimeApprovalRequest[]>;
  answerApproval(approvalId: string, answer: AssistantRequestAnswer): Promise<void>;
  /** Starts an independent, idempotent report turn; null defers while the conversation is busy. */
  deliverMailbox(threadId: string, input: { id: string; content: string; fromThreadId?: string; thinkingEffort?: string }): Promise<{ turnId: string | null }>;
  /** Live persisted events only; recovery reads durable thread state instead. */
  subscribeEvents(listener: (event: StoredThreadEvent) => void): () => void;
  secrets: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  fetch(input: string, init?: RequestInit): Promise<Response>;
  openWebSocket(url: string): AssistantWebSocket;
}

export const assistantsRuntimeHostCapability = defineCapability<AssistantsRuntimeHost>({
  id: 'assistants.runtime-host',
  description: 'Conversation, turn, approval and network access for personal assistants',
});

export type AssistantToolContext = { threadId: string; turnId?: string; interfaceLanguage?: RuntimeInterfaceLanguage };

export interface AssistantsToolService {
  /** Starts recovery, report flushing and QQ connections in the background. */
  start(): void;
  pendingMutationCount(): number;
  setMaintenancePaused(paused: boolean): void;
  isAssistantThread(threadId: string): boolean;
  listTools(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition[];
  systemPrompt(threadId: string, language?: RuntimeInterfaceLanguage): string | null;
  runTool(name: string, input: unknown, context: AssistantToolContext): Promise<{ content: string; preview?: string }>;
}

export const assistantsToolServiceCapability = defineCapability<AssistantsToolService>({
  id: 'assistants.tools',
  description: 'Orchestration tools available only inside assistant conversations',
});
