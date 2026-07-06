import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalList,
  RuntimeApprovalRequest,
} from '@setsuna-desktop/contracts';
import type { ApprovalGate, CreateApprovalInput } from '../../ports/approval-gate.js';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';

type PendingDecision = {
  resolve: (input: AnswerRuntimeApprovalInput) => void;
  reject: (error: Error) => void;
};

export class InMemoryApprovalGate implements ApprovalGate {
  private readonly approvals = new Map<string, RuntimeApprovalRequest>();
  private readonly pending = new Map<string, PendingDecision>();

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async createApproval(input: CreateApprovalInput): Promise<RuntimeApprovalRequest> {
    const approval: RuntimeApprovalRequest = {
      id: this.ids.id('approval'),
      status: 'pending',
      createdAt: this.clock.now().toISOString(),
      ...input,
    };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  async waitForDecision(approvalId: string): Promise<AnswerRuntimeApprovalInput> {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status === 'approved') return { decision: approval.decision ?? 'approve', message: approval.message };
    if (approval.status === 'rejected') return { decision: approval.decision ?? 'reject', message: approval.message };
    return new Promise((resolve, reject) => {
      this.pending.set(approvalId, { resolve, reject });
    });
  }

  async answerApproval(approvalId: string, input: AnswerRuntimeApprovalInput): Promise<RuntimeApprovalRequest> {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status !== 'pending') return approval;

    const next: RuntimeApprovalRequest = {
      ...approval,
      status: input.decision === 'reject' || input.decision === 'cancel' ? 'rejected' : 'approved',
      resolvedAt: this.clock.now().toISOString(),
      decision: input.decision,
      message: input.message,
    };
    this.approvals.set(approvalId, next);
    const pending = this.pending.get(approvalId);
    this.pending.delete(approvalId);
    pending?.resolve(input);
    return next;
  }

  async listApprovals(): Promise<RuntimeApprovalList> {
    return {
      approvals: [...this.approvals.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
