import type {
  AnswerRuntimeApprovalInput,
  RuntimePluginReference,
  RuntimeStructuredInputField,
  RuntimeUserInputRequest,
} from '@setsuna-desktop/contracts';
import type { ApprovalGate } from '../ports/approval-gate.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import { RuntimeEventWriter } from '../loop/lifecycle/runtime-event-writer.js';

export type ExtensionUiContext = {
  threadId: string;
  turnId?: string;
  toolCallId?: string;
  signal?: AbortSignal;
  onOutput?(message: string): void;
};

type UiMethod = 'ui.notify' | 'ui.confirm' | 'ui.select' | 'ui.input';

const MAX_TEXT_BYTES = 8 * 1024;
const MAX_OPTIONS = 20;

export class ExtensionUiCoordinator {
  constructor(
    private readonly approvals: ApprovalGate,
    private readonly events: Pick<RuntimeEventWriter, 'append'>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async handle(
    method: UiMethod,
    params: unknown,
    context: ExtensionUiContext,
    plugin: RuntimePluginReference,
  ): Promise<unknown> {
    const input = objectInput(params);
    const message = boundedText(input.message, 'message');
    if (method === 'ui.notify') {
      context.onOutput?.(`[${plugin.name}] ${message}\n`);
      await this.events.append(context.threadId, {
        id: this.ids.id('event'),
        threadId: context.threadId,
        ...(context.turnId ? { turnId: context.turnId } : {}),
        type: 'runtime.warning',
        createdAt: this.clock.now().toISOString(),
        payload: { message, code: `extension.notice:${plugin.id}` },
      });
      return null;
    }

    const turnId = requiredContextId(context.turnId, 'turnId');
    const toolCallId = requiredContextId(
      context.toolCallId,
      'toolCallId; interactive extension UI is available only while a tool is running',
    );
    const title = optionalBoundedText(input.title, 'title');
    const request = userInputRequest(method, input, message, title);
    const approval = await this.approvals.createApproval({
      threadId: context.threadId,
      turnId,
      toolCallId,
      toolName: `extension_ui:${plugin.id}`,
      reason: message,
      argumentsPreview: JSON.stringify({ plugin: plugin.name, method, title }),
      availableDecisions: [{ type: 'approve' }, { type: 'reject' }, { type: 'cancel' }],
      userInput: request,
    });
    await this.events.append(context.threadId, {
      id: this.ids.id('event'),
      threadId: context.threadId,
      turnId,
      type: 'approval.requested',
      createdAt: approval.createdAt,
      payload: { approval },
    });

    let answer: AnswerRuntimeApprovalInput;
    try {
      answer = await waitForDecision(this.approvals.waitForDecision(approval.id), context.signal);
    } catch (error) {
      answer = { decision: 'cancel', userInputResponse: { action: 'cancel' }, message: errorMessage(error) };
      const resolved = await this.approvals.answerApproval(approval.id, answer).catch(() => null);
      await this.events.append(context.threadId, {
        id: this.ids.id('event'),
        threadId: context.threadId,
        turnId,
        type: 'approval.resolved',
        createdAt: resolved?.resolvedAt ?? this.clock.now().toISOString(),
        payload: { approvalId: approval.id, decision: 'cancel', message: answer.message },
      });
      this.approvals.forgetApproval(approval.id);
      throw error;
    }

    try {
      await this.events.append(context.threadId, {
        id: this.ids.id('event'),
        threadId: context.threadId,
        turnId,
        type: 'approval.resolved',
        createdAt: this.clock.now().toISOString(),
        payload: { approvalId: approval.id, decision: answer.decision, ...(answer.message ? { message: answer.message } : {}) },
      });
      return uiAnswer(method, answer);
    } finally {
      this.approvals.forgetApproval(approval.id);
    }
  }
}

function userInputRequest(
  method: Exclude<UiMethod, 'ui.notify'>,
  input: Record<string, unknown>,
  message: string,
  title?: string,
): RuntimeUserInputRequest {
  let field: RuntimeStructuredInputField;
  if (method === 'ui.confirm') {
    field = { type: 'boolean', title: optionalBoundedText(input.label, 'label') ?? 'Confirm', default: false };
  } else if (method === 'ui.select') {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > MAX_OPTIONS) {
      throw new Error(`options must contain between 2 and ${MAX_OPTIONS} entries.`);
    }
    const seen = new Set<string>();
    const oneOf = input.options.map((item, index) => {
      const option = objectInput(item);
      const value = boundedText(option.value, `options[${index}].value`);
      const description = optionalBoundedText(option.description, `options[${index}].description`);
      if (seen.has(value)) throw new Error(`Duplicate extension UI option: ${value}`);
      seen.add(value);
      return {
        const: value,
        title: boundedText(option.label, `options[${index}].label`),
        ...(description ? { description } : {}),
      };
    });
    field = { type: 'string', title: optionalBoundedText(input.label, 'label') ?? 'Choose', oneOf };
  } else {
    field = {
      type: 'string',
      title: optionalBoundedText(input.label, 'label') ?? 'Value',
      ...(optionalBoundedText(input.placeholder, 'placeholder') ? { placeholder: optionalBoundedText(input.placeholder, 'placeholder') } : {}),
      ...(optionalBoundedText(input.default, 'default') ? { default: optionalBoundedText(input.default, 'default') } : {}),
      maxLength: 4_000,
    };
  }
  return {
    ...(title ? { title } : {}),
    message,
    requestedSchema: { type: 'object', properties: { value: field }, required: ['value'] },
  };
}

function uiAnswer(method: Exclude<UiMethod, 'ui.notify'>, answer: AnswerRuntimeApprovalInput): unknown {
  if (answer.decision !== 'approve' || answer.userInputResponse?.action !== 'submit') {
    return method === 'ui.confirm' ? false : null;
  }
  const value = answer.userInputResponse.values?.value;
  if (method === 'ui.confirm') return value === true;
  return typeof value === 'string' ? value : null;
}

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Extension UI input must be an object.');
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  const text = value.trim();
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error(`${label} is too large.`);
  return text;
}

function optionalBoundedText(value: unknown, label: string): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : boundedText(value, label);
}

function requiredContextId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Extension UI requires an active ${label}.`);
  return value;
}

function waitForDecision(decision: Promise<AnswerRuntimeApprovalInput>, signal?: AbortSignal): Promise<AnswerRuntimeApprovalInput> {
  if (!signal) return decision;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Extension UI was cancelled.'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Extension UI was cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    void decision.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
