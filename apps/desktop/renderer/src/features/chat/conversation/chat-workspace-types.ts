import type { AnswerRuntimeApprovalInput } from '@setsuna-desktop/contracts';

export type AnswerApprovalHandler = (
  approvalId: string,
  input: AnswerRuntimeApprovalInput,
) => void | Promise<void>;

export type WorkHistoryExpandedChangeHandler = (
  itemId: string,
  expanded: boolean,
) => void;
