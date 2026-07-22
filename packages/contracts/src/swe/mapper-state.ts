import type { RuntimeEvent } from '../events.js';
import type { RuntimeMailboxDeliveryRecord, RuntimeMessage, RuntimeThreadTurn } from '../threads.js';
import type { SweThreadItem, SweThreadStatus, SweTokenUsageBreakdown } from './types.js';

export type SweMapperState = {
  assistantStreams: Map<string, AssistantStreamState>;
  itemTranscriptMessageIds: Set<string>;
  turnDiffs: Map<string, string>;
  turnStartedAtMs: Map<string, number>;
  streamItems: Map<string, SweThreadItem>;
  startedItems: Set<string>;
  tokenUsageTotals: Map<string, SweTokenUsageBreakdown>;
  threadStatuses: Map<string, SweThreadStatus>;
  threadRuntime: Map<string, ThreadRuntimeState>;
  planMessageIds: Set<string>;
  planItemsByMessageId: Map<string, SweThreadItem>;
  turnPlanItemIds: Map<string, string>;
};

export type ThreadRuntimeState = {
  runningTurnIds: Set<string>;
  pendingApprovalIds: Set<string>;
  systemError: boolean;
};

export type AssistantStreamMode = 'markdown' | 'think';

export type AssistantStreamState = {
  text: string;
  mode: AssistantStreamMode;
  currentAgentItemId: string | null;
  currentReasoningItemId: string | null;
  agentSegmentIndex: number;
  reasoningSegmentIndex: number;
};

export type AssistantContentSegment = {
  content: string;
  type: AssistantStreamMode;
};

export type ToolCompletedPayload = Extract<RuntimeEvent, { type: 'tool.completed' }>['payload'];

export type RuntimeSweTurnEntry = {
  createdAt: string;
  index: number;
  message?: RuntimeMessage;
  mailbox?: RuntimeMailboxDeliveryRecord;
  turn?: RuntimeThreadTurn;
};
