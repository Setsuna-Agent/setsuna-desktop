import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  PendingStoredThreadEvent,
  StoredThreadEvent,
  RuntimeMessagePage,
  RuntimeMessage,
  RuntimeMessagePageQuery,
  RuntimeFileChangeOperation,
  RuntimeFileChangePreviewInput,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadModelBinding,
  RuntimeThreadSummary,
  RuntimeTaskKind,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';

export type RuntimeThreadMetadata = Pick<RuntimeThread, 'id' | 'createdAt' | 'projectId' | 'workspaceId' | 'lastSeq'>;

export type ThreadStorePatch = Omit<ThreadPatch, 'modelSelection'> & {
  featureId?: string | null;
  origin?: RuntimeThreadSummary['origin'];
  projectId?: string | null;
  /** Validated model identity resolved by the runtime boundary. */
  modelBinding?: RuntimeThreadModelBinding;
};

export type ThreadStoreCreateInput = Omit<CreateThreadInput, 'workspaceMode'> & {
  workspaceId?: string;
  kind?: NonNullable<RuntimeThreadSummary['kind']>;
  featureId?: string;
  origin?: RuntimeThreadSummary['origin'];
  modelBinding?: RuntimeThreadModelBinding;
  defaultSkillIds?: readonly string[];
};

export type ThreadStoreQuery = ThreadQuery & {
  /** Internal recovery paths include transient side conversations; user-facing lists do not. */
  includeSide?: boolean;
  /** Feature navigation and runtime recovery can include feature-owned conversations. */
  includeFeatures?: boolean;
};

export type RuntimeEventReplay = {
  events: StoredThreadEvent[];
  latestSeq: number;
  retainedFromSeq: number;
  requiresResync: boolean;
};

export type ThreadEventPageQuery = Readonly<{
  afterSeq: number;
  throughSeq: number;
  limit: number;
}>;

/** Domain queries can select durable lifecycle records without decoding the streaming history. */
export type ThreadEventFilter = Readonly<{
  turnId?: string;
  types: readonly StoredThreadEvent['type'][];
}>;

/** Small live-turn projection used by frequent runtime activity reads. */
export type RuntimeTurnActivityProjection = {
  queuedInputCount: number;
  startedAt: string | null;
  taskKind: RuntimeTaskKind;
  updatedAt: string;
};

/** Sampling needs message/attachment state, not the diagnostic history of every prior request. */
export type RuntimeThreadSamplingState = Pick<RuntimeThread, 'messages' | 'kind' | 'lastSeq' | 'messageCount' | 'updatedAt'>;

export type ContextWindowSnapshot = { messageIds: string[]; fingerprint: string; checkpointIds: string[]; mutationSeq?: number };
export type PendingContextCompactionEvent = Extract<PendingStoredThreadEvent, { type: 'thread.context_compacted' }>;
export type ContextCompactionCommitOptions = {
  signal?: AbortSignal;
  /** Synchronous final budget check under the same write queue as prefix validation. */
  acceptsWindow?: (messages: readonly RuntimeMessage[]) => boolean;
};

export type ThreadStore = {
  listThreads(query?: ThreadStoreQuery): Promise<RuntimeThreadSummary[]>;
  getThread(threadId: string): Promise<RuntimeThread | null>;
  getFileChangePreview?(threadId: string, input: RuntimeFileChangePreviewInput): Promise<RuntimeFileChangeOperation[] | null>;
  getThreadMetadata?(threadId: string): Promise<RuntimeThreadMetadata | null>;
  /** Recovery can inspect live turns without copying the full transcript and model diagnostics. */
  getActiveTurnIds?(threadId: string): Promise<string[]>;
  /** Managed image references can be read from checkpoint metadata without loading message bodies. */
  getGeneratedImageAssetIds?(threadId: string): Promise<string[]>;
  getSamplingState?(threadId: string): Promise<RuntimeThreadSamplingState | null>;
  getTurnActivity(threadId: string, turnId: string): Promise<RuntimeTurnActivityProjection | null>;
  getThreadPage(threadId: string, query?: RuntimeMessagePageQuery): Promise<RuntimeThread | null>;
  listMessages(threadId: string, query?: RuntimeMessagePageQuery): Promise<RuntimeMessagePage>;
  createThread(input?: ThreadStoreCreateInput): Promise<RuntimeThread>;
  deleteThread(threadId: string): Promise<void>;
  updateThread(threadId: string, patch: ThreadStorePatch): Promise<RuntimeThread>;
  updateThreadMemoryMode(threadId: string, mode: RuntimeThreadMemoryMode, reason?: string): Promise<RuntimeThread>;
  updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread>;
  deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread>;
  truncateMessagesAfter(threadId: string, messageId: string, includeSelf?: boolean): Promise<RuntimeThread>;
  clearThreadMessages(threadId: string): Promise<RuntimeThread>;
  appendEvent(threadId: string, event: PendingStoredThreadEvent): Promise<StoredThreadEvent>;
  /** Validate the captured window inside the write queue; a stale candidate is a normal non-commit. */
  commitContextCompaction?(threadId: string, expected: ContextWindowSnapshot, event: PendingContextCompactionEvent, options?: ContextCompactionCommitOptions): Promise<StoredThreadEvent | null>;
  appendEvents?(
    threadId: string,
    events: readonly PendingStoredThreadEvent[],
  ): Promise<StoredThreadEvent[]>;
  readEventPage(threadId: string, query: ThreadEventPageQuery): Promise<StoredThreadEvent[]>;
  listEvents(threadId: string, sinceSeq?: number, filter?: ThreadEventFilter): Promise<StoredThreadEvent[]>;
  replayEvents(threadId: string, sinceSeq?: number): Promise<RuntimeEventReplay>;
};
