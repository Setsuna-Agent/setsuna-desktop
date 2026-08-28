import type {
  ModelRequest,
  RuntimeTaskKind,
  RuntimeThread,
  RuntimeUsage,
  StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { ThreadTitleGenerationModelSelection } from './settings.js';

export type ThreadTitleGenerationModelOption = Readonly<{
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  modelCode: string;
}>;

export type ThreadTitleGenerationSettingsState = Readonly<{
  selection: ThreadTitleGenerationModelSelection;
  revision: number;
  availableModels: readonly ThreadTitleGenerationModelOption[];
}>;

export type ThreadTitleGenerationSettingsUpdate = Readonly<{
  expectedRevision: number;
  selection: ThreadTitleGenerationModelSelection;
}>;

export type ThreadTitleGenerationModelRequest = Pick<
  ModelRequest,
  | 'providerId'
  | 'model'
  | 'messages'
  | 'toolChoice'
  | 'temperature'
  | 'thinking'
  | 'responseFormat'
  | 'signal'
>;

export type ThreadTitleGenerationModelResult = Readonly<{
  content: string;
  finishReason?: string;
  usage?: RuntimeUsage;
}>;

export type ThreadTitleGenerationResolvedModel = Readonly<{
  model: string;
  providerId?: string;
}>;

export interface ThreadTitleGenerationRuntimeHost {
  now(): Date;
  resolveModel(input: Readonly<{
    selection: ThreadTitleGenerationModelSelection;
    fallback?: ThreadTitleGenerationResolvedModel;
  }>): Promise<ThreadTitleGenerationResolvedModel | null>;
  listModelOptions(): Promise<readonly ThreadTitleGenerationModelOption[]>;
  generateText(input: ThreadTitleGenerationModelRequest): Promise<ThreadTitleGenerationModelResult>;
  recordUsage(threadId: string, turnId: string, usage: RuntimeUsage): Promise<void>;
  flushThread(threadId: string): Promise<void>;
  listEvents(threadId: string, afterSeq: number): Promise<StoredThreadEvent[]>;
  getThread(threadId: string): Promise<RuntimeThread | null>;
  appendTitleUpdate(threadId: string, turnId: string, title: string): Promise<void>;
}

export type ThreadTitleGenerationStartInput = Readonly<{
  attachmentCount: number;
  conversationModel?: ThreadTitleGenerationResolvedModel;
  signal: AbortSignal;
  taskKind: RuntimeTaskKind;
  thread: RuntimeThread;
  userContent: string;
}>;

export type GeneratedThreadTitle = Readonly<{
  title: string | null;
  usage?: RuntimeUsage;
}>;

export type ThreadTitleGeneration = Readonly<{
  initialSeq: number;
  result: Promise<GeneratedThreadTitle | null>;
}>;

export interface ThreadTitleGenerationControl {
  readonly available: boolean;
  start(input: ThreadTitleGenerationStartInput): ThreadTitleGeneration | null;
  commit(
    threadId: string,
    turnId: string,
    generation: ThreadTitleGeneration | null | undefined,
  ): Promise<void>;
}

export interface ThreadTitleGenerationLegacySettingsAdapter {
  read(): Promise<ThreadTitleGenerationModelSelection>;
  retire(): Promise<void>;
}

export const threadTitleGenerationControlCapability: CapabilityToken<ThreadTitleGenerationControl> = defineCapability({
  id: 'thread-title-generation.control',
  description: 'Automatic first-turn title generation lifecycle',
});

export const threadTitleGenerationRuntimeHostCapability: CapabilityToken<ThreadTitleGenerationRuntimeHost> = defineCapability({
  id: 'thread-title-generation.runtime-host',
  description: 'Narrow model, thread-event, and usage services required by automatic title generation',
});

export const threadTitleGenerationLegacySettingsCapability: CapabilityToken<ThreadTitleGenerationLegacySettingsAdapter> = defineCapability({
  id: 'thread-title-generation.legacy-settings',
  description: 'One-way reader and cleanup adapter for the legacy threadTitle task model',
});

export function createNoopThreadTitleGenerationControl(): ThreadTitleGenerationControl {
  return Object.freeze({
    available: false,
    start: () => null,
    commit: async () => undefined,
  });
}
