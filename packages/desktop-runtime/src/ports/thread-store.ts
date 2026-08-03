import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RuntimeEvent,
  RuntimeMessagePage,
  RuntimeMessagePageQuery,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';

export type RuntimeEventReplay = {
  events: RuntimeEvent[];
  latestSeq: number;
  retainedFromSeq: number;
  requiresResync: boolean;
};

export type ThreadStore = {
  listThreads(query?: ThreadQuery): Promise<RuntimeThreadSummary[]>;
  getThread(threadId: string): Promise<RuntimeThread | null>;
  getThreadPage(threadId: string, query?: RuntimeMessagePageQuery): Promise<RuntimeThread | null>;
  listMessages(threadId: string, query?: RuntimeMessagePageQuery): Promise<RuntimeMessagePage>;
  createThread(input?: CreateThreadInput): Promise<RuntimeThread>;
  deleteThread(threadId: string): Promise<void>;
  updateThread(threadId: string, patch: ThreadPatch): Promise<RuntimeThread>;
  updateThreadMemoryMode(threadId: string, mode: RuntimeThreadMemoryMode, reason?: string): Promise<RuntimeThread>;
  updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread>;
  deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread>;
  truncateMessagesAfter(threadId: string, messageId: string, includeSelf?: boolean): Promise<RuntimeThread>;
  clearThreadMessages(threadId: string): Promise<RuntimeThread>;
  appendEvent(threadId: string, event: Omit<RuntimeEvent, 'seq'>): Promise<RuntimeEvent>;
  listEvents(threadId: string, sinceSeq?: number): Promise<RuntimeEvent[]>;
  replayEvents(threadId: string, sinceSeq?: number): Promise<RuntimeEventReplay>;
};
