import type { AnswerRuntimeApprovalInput } from '@setsuna-desktop/contracts';
import type { ReactNode } from 'react';

/** A host can show its starter before the first turn even with setup messages present. */
export type ChatStarterPresentation = Readonly<{
  content: ReactNode;
  footer?: ReactNode;
  visible: boolean;
}>;

export type AnswerApprovalHandler = (
  approvalId: string,
  input: AnswerRuntimeApprovalInput,
) => void | Promise<void>;

export type WorkHistoryExpandedChangeHandler = (
  itemId: string,
  expanded: boolean,
) => void;
