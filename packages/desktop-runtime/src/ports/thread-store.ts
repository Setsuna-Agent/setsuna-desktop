import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  PendingStoredThreadEvent,
  StoredThreadEvent,
  RuntimeMessagePage,
  RuntimeMessagePageQuery,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadModelBinding,
  RuntimeThreadSummary,
  RuntimeTaskKind,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';

export type ThreadStorePatch = Omit<ThreadPatch, 'modelSelection'> & {
  /** Validated model identity resolved by the runtime boundary. */
  modelBinding?: RuntimeThreadModelBinding;
};

export type ThreadStoreCreateInput = CreateThreadInput & {
  kind?: NonNullable<RuntimeThreadSummary['kind']>;
  modelBinding?: RuntimeThreadModelBinding;
};

export type ThreadStoreQuery = ThreadQuery & {
  /** Internal recovery paths include transient side conversations; user-facing lists do not. */
  includeSide?: boolean;
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

/** Small live-turn projection used by frequent runtime activity reads. */
export type RuntimeTurnActivityProjection = {
  queuedInputCount: number;
  startedAt: string | null;
  taskKind: RuntimeTaskKind;
  updatedAt: string;
};

export type ThreadStore = {
  listThreads(query?: ThreadStoreQuery): Promise<RuntimeThreadSummary[]>;
  getThread(threadId: string): Promise<RuntimeThread | null>;
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
  appendEvents?(
    threadId: string,
    events: readonly PendingStoredThreadEvent[],
  ): Promise<StoredThreadEvent[]>;
  readEventPage(threadId: string, query: ThreadEventPageQuery): Promise<StoredThreadEvent[]>;
  listEvents(threadId: string, sinceSeq?: number): Promise<StoredThreadEvent[]>;
  replayEvents(threadId: string, sinceSeq?: number): Promise<RuntimeEventReplay>;
};
