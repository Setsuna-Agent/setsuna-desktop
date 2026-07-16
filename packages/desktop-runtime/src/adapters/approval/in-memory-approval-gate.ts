import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalList,
  RuntimeApprovalRequest,
  RuntimeMcpElicitationField,
  RuntimeMcpElicitationSchema,
  RuntimeMcpElicitationValue,
  RuntimeUserInputResponse,
} from '@setsuna-desktop/contracts';
import type { ApprovalGate, CreateApprovalInput } from '../../ports/approval-gate.js';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';

type PendingDecision = {
  resolve: (input: AnswerRuntimeApprovalInput) => void;
  reject: (error: Error) => void;
};

type PendingApprovalWaiter = {
  resolve: (approval: RuntimeApprovalRequest) => void;
  reject: (error: Error) => void;
};

const MAX_RETAINED_RESOLVED_APPROVALS = 100;

export class InMemoryApprovalGate implements ApprovalGate {
  private readonly approvals = new Map<string, RuntimeApprovalRequest>();
  private readonly pending = new Map<string, PendingDecision>();
  private readonly pendingApprovalWaiters = new Set<PendingApprovalWaiter>();
  private readonly resolvedAnswers = new Map<string, AnswerRuntimeApprovalInput>();

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async createApproval(input: CreateApprovalInput): Promise<RuntimeApprovalRequest> {
    if (input.elicitation && input.userInput) throw new Error('An approval cannot contain both MCP elicitation and user input.');
    const approval: RuntimeApprovalRequest = {
      id: this.ids.id('approval'),
      status: 'pending',
      createdAt: this.clock.now().toISOString(),
      ...input,
    };
    this.approvals.set(approval.id, approval);
    this.resolvePendingApprovalWaiters(approval);
    return approval;
  }

  waitForPendingApproval(): Promise<RuntimeApprovalRequest> {
    const pending = this.pendingApproval();
    if (pending) return Promise.resolve(pending);
    return new Promise((resolve, reject) => {
      this.pendingApprovalWaiters.add({ resolve, reject });
    });
  }

  async waitForDecision(approvalId: string): Promise<AnswerRuntimeApprovalInput> {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status === 'approved') {
      return this.resolvedAnswers.get(approvalId) ?? { decision: approval.decision ?? 'approve', message: approval.message };
    }
    if (approval.status === 'rejected' || approval.status === 'cancelled') {
      return this.resolvedAnswers.get(approvalId) ?? {
        decision: approval.decision ?? (approval.status === 'cancelled' ? 'cancel' : 'reject'),
        message: approval.message,
      };
    }
    return new Promise((resolve, reject) => {
      this.pending.set(approvalId, { resolve, reject });
    });
  }

  async answerApproval(approvalId: string, input: AnswerRuntimeApprovalInput): Promise<RuntimeApprovalRequest> {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status !== 'pending') return approval;
    validateElicitationAnswer(approval, input);
    validateUserInputAnswer(approval, input);

    const next: RuntimeApprovalRequest = {
      ...approval,
      status: input.decision === 'cancel' ? 'cancelled' : input.decision === 'reject' ? 'rejected' : 'approved',
      resolvedAt: this.clock.now().toISOString(),
      decision: input.decision,
      message: input.message,
    };
    this.approvals.set(approvalId, next);
    this.resolvedAnswers.set(approvalId, input);
    const pending = this.pending.get(approvalId);
    this.pending.delete(approvalId);
    pending?.resolve(input);
    this.pruneResolvedApprovals();
    return next;
  }

  async listApprovals(): Promise<RuntimeApprovalList> {
    return {
      approvals: [...this.approvals.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  forgetApproval(approvalId: string): void {
    if (this.approvals.get(approvalId)?.status === 'pending') return;
    this.approvals.delete(approvalId);
    this.resolvedAnswers.delete(approvalId);
  }

  rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const waiter of this.pendingApprovalWaiters) waiter.reject(error);
    this.pendingApprovalWaiters.clear();
  }

  private pendingApproval(): RuntimeApprovalRequest | undefined {
    return [...this.approvals.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .find((approval) => approval.status === 'pending');
  }

  private resolvePendingApprovalWaiters(approval: RuntimeApprovalRequest): void {
    if (!this.pendingApprovalWaiters.size) return;
    const waiters = [...this.pendingApprovalWaiters];
    this.pendingApprovalWaiters.clear();
    for (const waiter of waiters) waiter.resolve(approval);
  }

  private pruneResolvedApprovals(): void {
    const resolved = [...this.approvals.values()]
      .filter((approval) => approval.status !== 'pending')
      .sort((left, right) => right.resolvedAt!.localeCompare(left.resolvedAt!));
    for (const approval of resolved.slice(MAX_RETAINED_RESOLVED_APPROVALS)) {
      this.approvals.delete(approval.id);
      this.resolvedAnswers.delete(approval.id);
    }
  }
}

function validateElicitationAnswer(approval: RuntimeApprovalRequest, input: AnswerRuntimeApprovalInput): void {
  if (!approval.elicitation) {
    if (input.elicitationResponse) throw new Error('Elicitation response is not valid for this approval.');
    return;
  }
  const response = input.elicitationResponse;
  if (!response) throw new Error('Elicitation response is required.');
  const expectedAction = input.decision === 'approve'
    ? 'accept'
    : input.decision === 'reject'
      ? 'decline'
      : input.decision === 'cancel'
        ? 'cancel'
        : null;
  if (!expectedAction || response.action !== expectedAction) {
    throw new Error('Elicitation action does not match the approval decision.');
  }
  if (response.action !== 'accept') {
    if (response.content && Object.keys(response.content).length) {
      throw new Error('Declined or cancelled elicitations cannot include form content.');
    }
    return;
  }
  if (approval.elicitation.mode === 'url') {
    if (response.content && Object.keys(response.content).length) {
      throw new Error('URL elicitations cannot include form content.');
    }
    return;
  }
  validateStructuredInputContent(approval.elicitation.requestedSchema, response.content ?? {}, 'Elicitation', true);
}

function validateUserInputAnswer(approval: RuntimeApprovalRequest, input: AnswerRuntimeApprovalInput): void {
  if (!approval.userInput) {
    if (input.userInputResponse) throw new Error('User input response is not valid for this approval.');
    return;
  }
  const response = input.userInputResponse;
  if (!response) throw new Error('User input response is required.');
  if (!userInputActionMatchesDecision(input.decision, response.action)) {
    throw new Error('User input action does not match the approval decision.');
  }
  if (response.action === 'decline' || response.action === 'cancel') {
    if (response.values && Object.keys(response.values).length) {
      throw new Error('Declined or cancelled user input cannot include values.');
    }
    return;
  }
  validateStructuredInputContent(
    approval.userInput.requestedSchema,
    response.values ?? {},
    'User input',
    response.action === 'submit',
  );
}

function userInputActionMatchesDecision(
  decision: AnswerRuntimeApprovalInput['decision'],
  action: RuntimeUserInputResponse['action'],
): boolean {
  if (decision === 'approve') return action === 'submit' || action === 'timeout';
  if (decision === 'reject') return action === 'decline';
  if (decision === 'cancel') return action === 'cancel';
  return false;
}

function validateStructuredInputContent(
  schema: RuntimeMcpElicitationSchema,
  content: Record<string, RuntimeMcpElicitationValue>,
  label: string,
  enforceRequired: boolean,
): void {
  if (enforceRequired) {
    for (const name of schema.required ?? []) {
      if (content[name] === undefined || content[name] === '') {
        throw new Error(`${label} field '${name}' is required.`);
      }
    }
  }
  for (const [name, value] of Object.entries(content)) {
    const field = schema.properties[name];
    if (!field) throw new Error(`Unknown ${label.toLowerCase()} field '${name}'.`);
    validateStructuredInputField(name, field, value, label);
  }
}

function validateStructuredInputField(
  name: string,
  field: RuntimeMcpElicitationField,
  value: RuntimeMcpElicitationValue,
  label: string,
): void {
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') throw fieldTypeError(label, name, 'a boolean');
    return;
  }
  if (field.type === 'number' || field.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw fieldTypeError(label, name, 'a finite number');
    if (field.type === 'integer' && !Number.isInteger(value)) throw fieldTypeError(label, name, 'an integer');
    if (field.minimum !== undefined && value < field.minimum) throw new Error(`${label} field '${name}' is below its minimum.`);
    if (field.maximum !== undefined && value > field.maximum) throw new Error(`${label} field '${name}' is above its maximum.`);
    return;
  }
  if (field.type === 'array') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw fieldTypeError(label, name, 'a string array');
    if (field.minItems !== undefined && value.length < field.minItems) throw new Error(`${label} field '${name}' has too few selections.`);
    if (field.maxItems !== undefined && value.length > field.maxItems) throw new Error(`${label} field '${name}' has too many selections.`);
    const allowed = new Set(field.items?.enum ?? field.items?.anyOf?.map((item) => item.const) ?? []);
    if (allowed.size && value.some((item) => !allowed.has(item))) throw new Error(`${label} field '${name}' contains an invalid selection.`);
    return;
  }
  if (typeof value !== 'string') throw fieldTypeError(label, name, 'a string');
  if (field.minLength !== undefined && value.length < field.minLength) throw new Error(`${label} field '${name}' is too short.`);
  if (field.maxLength !== undefined && value.length > field.maxLength) throw new Error(`${label} field '${name}' is too long.`);
  const allowed = new Set(field.enum ?? field.oneOf?.map((item) => item.const) ?? []);
  if (allowed.size && !allowed.has(value)) throw new Error(`${label} field '${name}' contains an invalid selection.`);
  if (field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) throw new Error(`${label} field '${name}' must be an email address.`);
  if (field.format === 'uri') {
    try {
      new URL(value);
    } catch {
      throw new Error(`${label} field '${name}' must be a valid URI.`);
    }
  }
  if (field.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`${label} field '${name}' must be a date.`);
  if (field.format === 'date-time' && !Number.isFinite(Date.parse(value))) throw new Error(`${label} field '${name}' must be a date-time.`);
}

function fieldTypeError(label: string, name: string, expected: string): Error {
  return new Error(`${label} field '${name}' must be ${expected}.`);
}
