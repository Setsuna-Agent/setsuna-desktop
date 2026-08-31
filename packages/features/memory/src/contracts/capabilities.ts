import type {
  ModelRequest,
  ModelStreamEvent,
  PendingRuntimeEvent,
  RuntimeConfiguredModelReference,
  RuntimeMemoryCitation,
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
  RuntimeToolCall,
  RuntimeToolDefinition,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { MemoryPreferences, MemoryPreferencesPatch } from './settings.js';
import type { MemoryStore } from './store.js';
import type { RuntimeMemoryPreview } from './types.js';

export type MemoryModelOption = Readonly<{
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  modelCode: string;
}>;

export type MemorySettingsState = Readonly<{
  value: MemoryPreferences;
  revision: number;
  availableModels: readonly MemoryModelOption[];
}>;

export type MemorySettingsUpdate = Readonly<{
  expectedRevision: number;
  patch: MemoryPreferencesPatch;
}>;

export type MemoryToolContext = Readonly<{
  threadId: string;
  projectId?: string;
  turnId?: string;
  features?: Readonly<Record<string, boolean>>;
}>;

export type MemoryToolExecutionResult = Readonly<{
  content: string;
  data?: unknown;
  containsExternalContext?: boolean;
}>;

export type MemoryCitationOutputFilter = {
  push(delta: string): Readonly<{ visibleText: string }>;
  finish(): Readonly<{ visibleText: string; citation?: RuntimeMemoryCitation }>;
};

export interface MemoryControl {
  readonly available: boolean;
  readSettings(): Promise<MemorySettingsState>;
  updateSettings(input: MemorySettingsUpdate): Promise<MemorySettingsState>;
  preview(): Promise<RuntimeMemoryPreview>;
  delete(memoryId: string): Promise<void>;
  clear(): Promise<void>;
  updateThreadMode(threadId: string, mode: RuntimeThreadMemoryMode, reason?: string): Promise<RuntimeThread>;
  runStartupExtraction(): Promise<{ claimed: number; extracted: number }>;
  recordCitationUsage(citation: RuntimeMemoryCitation | undefined): Promise<void>;
  schedulePassiveMemoriesForTurn(threadId: string, turnId: string): void;
  waitForPassiveMemoriesForTurn(threadId: string, turnId: string): Promise<void>;
  pendingBackgroundTaskCount(): number;
  shutdown(timeoutMs: number): Promise<boolean>;
  rememberExplicitUserMemory(threadId: string, turnId: string, input?: Readonly<{
    alreadySaved: boolean;
    projectId?: string;
    userContent: string;
  }>): Promise<void>;
  contextMessages(projectId?: string): Promise<RuntimeMessage[]>;
  toolBlockForCall(toolCall: RuntimeToolCall, threadId: string): Promise<string | null>;
  markPollutedByExternalContext(
    threadId: string,
    turnId: string,
    toolCall: RuntimeToolCall,
    result: Readonly<{ containsExternalContext?: boolean }>,
  ): Promise<void>;
  isSuccessfulRememberMessage(message: RuntimeMessage): boolean;
  createCitationOutputFilter(): MemoryCitationOutputFilter;
  systemPrompt(context: MemoryToolContext): Promise<string | null>;
  listTools(context: MemoryToolContext): Promise<readonly RuntimeToolDefinition[]>;
  runTool(name: string, input: unknown, context: MemoryToolContext): Promise<MemoryToolExecutionResult>;
}

export const memoryControlCapability: CapabilityToken<MemoryControl> = defineCapability({
  id: 'memory.control',
  description: 'Long-term memory lifecycle, context, tools, settings, and management operations',
});

export interface MemoryRuntimeHost {
  readonly store: MemoryStore;
  now(): Date;
  id(prefix: string): string;
  listThreads(query?: Readonly<{ includeArchived?: boolean }>): Promise<RuntimeThreadSummary[]>;
  getThread(threadId: string): Promise<RuntimeThread | null>;
  updateThreadMode(threadId: string, mode: RuntimeThreadMemoryMode, reason?: string): Promise<RuntimeThread>;
  appendEvent(threadId: string, event: PendingRuntimeEvent): Promise<void>;
  streamModel(request: ModelRequest): AsyncGenerator<ModelStreamEvent>;
  recordUsage(input: RuntimeUsage & Readonly<{ threadId: string; turnId: string; createdAt: string }>): Promise<void>;
  resolveModel(input: Readonly<{
    selection: RuntimeConfiguredModelReference | null;
    legacyModelCode?: string;
    fallbackModel: string;
    thread?: RuntimeThread;
    preferThreadModel?: boolean;
  }>): Promise<Pick<ModelRequest, 'model' | 'providerId'>>;
  hasActiveModel(): Promise<boolean>;
  listModelOptions(): Promise<readonly MemoryModelOption[]>;
  sharedMemoryFilesEnabled(): Promise<boolean>;
}

export const memoryRuntimeHostCapability: CapabilityToken<MemoryRuntimeHost> = defineCapability({
  id: 'memory.runtime-host',
  description: 'Narrow model, thread, event, usage, and persistence services required by Memory',
});

export type LegacyMemorySettings = Readonly<{ value: MemoryPreferences }>;
export interface MemoryLegacySettingsAdapter {
  read(): Promise<LegacyMemorySettings>;
  retire(): Promise<void>;
}

export const memoryLegacySettingsCapability: CapabilityToken<MemoryLegacySettingsAdapter> = defineCapability({
  id: 'memory.legacy-settings',
  description: 'One-way reader and cleanup adapter for pre-Feature memory settings',
});

export function createNoopMemoryControl(): MemoryControl {
  const settings = Object.freeze({
    value: Object.freeze({
      useMemories: false,
      generateMemories: false,
      disableOnExternalContext: false,
      extractionModel: null,
      consolidationModel: null,
    }),
    revision: 0,
    availableModels: Object.freeze([]),
  });
  return Object.freeze({
    available: false,
    readSettings: async () => settings,
    updateSettings: async () => settings,
    preview: async () => Object.freeze({ storagePath: '', total: 0, items: [] }),
    delete: async () => undefined,
    clear: async () => undefined,
    updateThreadMode: async () => { throw new Error('Memory Feature is unavailable.'); },
    runStartupExtraction: async () => ({ claimed: 0, extracted: 0 }),
    recordCitationUsage: async () => undefined,
    schedulePassiveMemoriesForTurn: () => undefined,
    waitForPassiveMemoriesForTurn: async () => undefined,
    pendingBackgroundTaskCount: () => 0,
    shutdown: async () => true,
    rememberExplicitUserMemory: async () => undefined,
    contextMessages: async () => [],
    toolBlockForCall: async () => null,
    markPollutedByExternalContext: async () => undefined,
    isSuccessfulRememberMessage: () => false,
    createCitationOutputFilter: () => passthroughCitationFilter(),
    systemPrompt: async () => null,
    listTools: async () => [],
    runTool: async () => { throw new Error('Memory Feature is unavailable.'); },
  });
}

function passthroughCitationFilter(): MemoryCitationOutputFilter {
  return {
    push: (delta) => ({ visibleText: delta }),
    finish: () => ({ visibleText: '' }),
  };
}
