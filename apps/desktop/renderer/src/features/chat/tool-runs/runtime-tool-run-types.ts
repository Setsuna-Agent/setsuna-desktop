import type {
  AnswerRuntimeApprovalInput,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';

export type ToolRunGroup =
  | { type: 'single'; run: RuntimeToolRun }
  | {
      type: 'group';
      id: string;
      kind: ToolRunGroupKind;
      runs: RuntimeToolRun[];
    };

export type ToolRunDisplayGroup =
  | ToolRunGroup
  | {
      type: 'mixed';
      id: string;
      groups: ToolRunGroup[];
      summaryMode: ToolRunSummaryMode;
    };

export type ToolRunGroupKind =
  | 'inspection'
  | 'search'
  | 'shell'
  | 'fileMutation'
  | 'generic';

export type ToolRunSummaryMode = 'aggregate' | 'latest';

export type AnswerApprovalHandler = (
  approvalId: string,
  input: AnswerRuntimeApprovalInput,
) => void | Promise<void>;
