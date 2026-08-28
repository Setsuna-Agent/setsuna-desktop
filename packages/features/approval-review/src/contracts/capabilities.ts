import type {
  ModelRequest,
  RuntimeApprovalReviewAssessment,
  RuntimeApprovalRetryKind,
  RuntimeExecPolicyAmendment,
  RuntimeNetworkApprovalContext,
  RuntimeNetworkPolicyAmendment,
  RuntimePermissionApprovalContext,
  RuntimeThread,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { ApprovalReviewModelSelection } from './settings.js';

export type ApprovalReviewRequest = Readonly<{
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  retryKind?: RuntimeApprovalRetryKind;
  proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
  networkApprovalContext?: RuntimeNetworkApprovalContext;
  proposedNetworkPolicyAmendments?: RuntimeNetworkPolicyAmendment[];
  environmentId?: string;
  additionalPermissions?: unknown;
  permissionApprovalContext?: RuntimePermissionApprovalContext;
}>;

export type ApprovalReviewInput = Readonly<{
  /** Exact parsed arguments are ephemeral and must never be copied into audit events. */
  arguments: unknown;
  request: ApprovalReviewRequest;
  signal: AbortSignal;
}>;

export type ApprovalReviewResult = Readonly<{
  assessment: RuntimeApprovalReviewAssessment;
  /** Stops an escalation loop after repeated automatic denials in one turn. */
  interruptTurn?: boolean;
}>;

export interface ApprovalReviewer {
  review(input: ApprovalReviewInput): Promise<ApprovalReviewResult>;
}

export interface ApprovalReviewControl extends ApprovalReviewer {
  readonly available: boolean;
}

export type ApprovalReviewModelOption = Readonly<{
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  modelCode: string;
}>;

export type ApprovalReviewSettingsState = Readonly<{
  selection: ApprovalReviewModelSelection;
  revision: number;
  availableModels: readonly ApprovalReviewModelOption[];
}>;

export type ApprovalReviewSettingsUpdate = Readonly<{
  expectedRevision: number;
  selection: ApprovalReviewModelSelection;
}>;

export type ApprovalReviewResolvedModel = Readonly<{
  model: string;
  providerId?: string;
}>;

export type ApprovalReviewModelRequest = Pick<
  ModelRequest,
  | 'providerId'
  | 'model'
  | 'messages'
  | 'toolChoice'
  | 'temperature'
  | 'thinking'
  | 'responseFormat'
  | 'signal'
>;

export type ApprovalReviewModelResult = Readonly<{
  content: string;
  usage?: RuntimeUsage;
}>;

export interface ApprovalReviewRuntimeHost {
  now(): Date;
  getThread(threadId: string): Promise<RuntimeThread | null>;
  resolveModel(input: Readonly<{
    selection: ApprovalReviewModelSelection;
    thread: RuntimeThread;
  }>): Promise<ApprovalReviewResolvedModel>;
  listModelOptions(): Promise<readonly ApprovalReviewModelOption[]>;
  generateText(input: ApprovalReviewModelRequest): Promise<ApprovalReviewModelResult>;
  recordUsage(threadId: string, turnId: string, usage: RuntimeUsage): Promise<void>;
}

export interface ApprovalReviewLegacySettingsAdapter {
  read(): Promise<ApprovalReviewModelSelection>;
  retire(): Promise<void>;
}

export const approvalReviewControlCapability: CapabilityToken<ApprovalReviewControl> = defineCapability({
  id: 'approval-review.control',
  description: 'Model-backed automatic approval decision service',
});

export const approvalReviewRuntimeHostCapability: CapabilityToken<ApprovalReviewRuntimeHost> = defineCapability({
  id: 'approval-review.runtime-host',
  description: 'Narrow model, thread, clock, and usage services required by automatic approval review',
});

export const approvalReviewLegacySettingsCapability: CapabilityToken<ApprovalReviewLegacySettingsAdapter> = defineCapability({
  id: 'approval-review.legacy-settings',
  description: 'One-way reader and cleanup adapter for the legacy approvalReview task model',
});

export function createNoopApprovalReviewControl(): ApprovalReviewControl {
  return Object.freeze({
    available: false,
    review: async (): Promise<ApprovalReviewResult> => ({
      assessment: {
        status: 'failed',
        rationale: 'Automatic approval review is unavailable.',
      },
    }),
  } satisfies ApprovalReviewControl);
}
