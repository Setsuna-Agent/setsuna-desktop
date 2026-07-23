import type { ModelProviderKind } from './model-provider.js';

export type RuntimeDebugTraceKind =
  | 'context.compaction.completed'
  | 'context.compaction.native'
  | 'context.compaction.portable'
  | 'model.history.normalized'
  | 'provider.replay.decision';

export type RuntimeToolCallWireRewrite = {
  assistantMessageId: string;
  callIndex: number;
  providerMetadataRemoved: boolean;
  semanticCallId: string;
  toolResultMessageIds: string[];
  wireCallId: string;
};

export type RuntimeHistoryNormalizationDebugPayload = {
  inputMessageCount: number;
  interruptedToolResultMessageIds: string[];
  orphanToolResultMessageIds: string[];
  outputMessageCount: number;
  warnings: string[];
  wireToolCallRewrites: RuntimeToolCallWireRewrite[];
};

export type RuntimeProviderReplayReason =
  | 'context_mismatch'
  | 'legacy_provider_mismatch'
  | 'metadata_missing'
  | 'native_envelope_invalid'
  | 'native_replay_compatible'
  | 'semantic_mismatch'
  | 'unsupported_provider';

export type RuntimeProviderReplayDebugPayload = {
  messageId: string;
  model: string;
  nativeItemCount: number;
  providerId: string;
  providerKind: ModelProviderKind;
  reason: RuntimeProviderReplayReason;
  strategy: 'native' | 'semantic';
};

export type RuntimeCompactionDebugPayload = {
  error?: string;
  metadataPersisted?: boolean;
  olderMessageCount: number;
  outcome: 'error' | 'fallback' | 'started' | 'success' | 'unsupported';
  recentMessageCount: number;
  source?: 'local' | 'remote';
  summaryCharacters?: number;
};

export type RuntimeDebugTracePayloadByKind = {
  'context.compaction.completed': RuntimeCompactionDebugPayload;
  'context.compaction.native': RuntimeCompactionDebugPayload;
  'context.compaction.portable': RuntimeCompactionDebugPayload;
  'model.history.normalized': RuntimeHistoryNormalizationDebugPayload;
  'provider.replay.decision': RuntimeProviderReplayDebugPayload;
};

export type RuntimeDebugTraceEvent = {
  [TKind in RuntimeDebugTraceKind]: {
    /** Highest committed RuntimeEvent.seq observed before this trace was emitted. */
    afterEventSeq: number;
    createdAt: string;
    id: string;
    kind: TKind;
    payload: RuntimeDebugTracePayloadByKind[TKind];
    seq: number;
    spanId?: string;
    threadId: string;
    turnId?: string;
  }
}[RuntimeDebugTraceKind];

export type RuntimeDebugTraceInput = {
  [TKind in RuntimeDebugTraceKind]: {
    /** Highest committed RuntimeEvent.seq observed before this trace was emitted. */
    afterEventSeq: number;
    kind: TKind;
    payload: RuntimeDebugTracePayloadByKind[TKind];
    spanId?: string;
    threadId: string;
    turnId?: string;
  }
}[RuntimeDebugTraceKind];

export type RuntimeDebugTraceList = {
  droppedBeforeSeq?: number;
  nextSeq: number;
  traces: RuntimeDebugTraceEvent[];
};
