import type { StoredThreadEvent } from '@setsuna-desktop/contracts';

export type ConversationDebugEventPageQuery = Readonly<{
  afterSeq: string;
  limit: string;
  threadId: string;
  throughSeq: string;
}>;

/** One exact, contiguous slice of the durable thread event log. */
export type ConversationDebugEventPage = Readonly<{
  records: readonly StoredThreadEvent[];
  /** Fixed history watermark shared by every page in one renderer load. */
  throughSeq: number;
}>;
