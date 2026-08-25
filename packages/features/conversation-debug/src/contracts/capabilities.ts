import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type {
  ConversationDebugSettings,
  ConversationDebugSettingsState,
  ConversationDebugSettingsUpdate,
} from './settings.js';
import type {
  RuntimeDebugTraceInput,
  RuntimeDebugTraceList,
} from './traces.js';

/** Stable Core-facing seam. The runtime host binds the active optional Feature after startup. */
export interface ConversationDebugTraceSink {
  enabled(): boolean;
  append(input: RuntimeDebugTraceInput): void;
}

export interface ConversationDebugControl extends ConversationDebugTraceSink {
  readSettings(): Promise<ConversationDebugSettingsState>;
  updateSettings(input: ConversationDebugSettingsUpdate): Promise<ConversationDebugSettingsState>;
  listTraces(threadId: string, afterSeq?: number): RuntimeDebugTraceList;
}

export const conversationDebugControlCapability: CapabilityToken<ConversationDebugControl> = defineCapability({
  id: 'conversation-debug.control',
  description: 'Conversation debug settings, bounded trace collection, and trace queries',
});

export interface ConversationDebugRuntimeHost {
  id(prefix: string): string;
  now(): Date;
  threadExists(threadId: string): Promise<boolean>;
}

export const conversationDebugRuntimeHostCapability: CapabilityToken<ConversationDebugRuntimeHost> = defineCapability({
  id: 'conversation-debug.runtime-host',
  description: 'Clock, identifiers, and thread lookup required by conversation diagnostics',
});

export interface ConversationDebugLegacySettingsAdapter {
  read(): Promise<ConversationDebugSettings>;
  retire(): Promise<void>;
}

export const conversationDebugLegacySettingsCapability: CapabilityToken<ConversationDebugLegacySettingsAdapter> = defineCapability({
  id: 'conversation-debug.legacy-settings',
  description: 'One-way reader and cleanup adapter for the legacy developer_features flag',
});

export function createNoopConversationDebugControl(): ConversationDebugControl {
  const settings = Object.freeze({ value: Object.freeze({ enabled: false }), revision: 0 });
  return Object.freeze({
    enabled: () => false,
    append: () => undefined,
    readSettings: async () => settings,
    updateSettings: async () => settings,
    listTraces: () => Object.freeze({ nextSeq: 1, traces: Object.freeze([]) }),
  });
}
