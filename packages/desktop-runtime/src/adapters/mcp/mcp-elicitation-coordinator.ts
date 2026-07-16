import type {
  AnswerRuntimeApprovalInput,
  RuntimeMcpElicitation,
  RuntimeMcpElicitationResponse,
  RuntimeMcpElicitationSchema,
} from '@setsuna-desktop/contracts';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApprovalGate } from '../../ports/approval-gate.js';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { RuntimeEventWriter } from '../../loop/runtime-event-writer.js';

const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_FORM_FIELDS = 50;
const MAX_ELICITATION_URL_BYTES = 16 * 1024;

export type McpElicitationExecutionContext = {
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  signal?: AbortSignal;
};

export type McpElicitationHandler = Pick<McpElicitationCoordinator, 'request'>;

/**
 * Bridges protocol-level MCP elicitation into the runtime's audited approval
 * lifecycle. Form answers remain in the in-memory gate and are never copied
 * into append-only events.
 */
export class McpElicitationCoordinator {
  constructor(
    private readonly approvalGate: ApprovalGate,
    private readonly eventWriter: RuntimeEventWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async request(
    serverKey: string,
    params: ElicitRequest['params'],
    context: McpElicitationExecutionContext,
  ): Promise<ElicitResult> {
    const elicitation = normalizeElicitation(serverKey, params);
    const approval = await this.approvalGate.createApproval({
      threadId: context.threadId,
      turnId: context.turnId,
      toolCallId: context.toolCallId,
      toolName: context.toolName,
      reason: elicitation.message,
      argumentsPreview: elicitationPreview(elicitation),
      availableDecisions: [{ type: 'approve' }, { type: 'reject' }, { type: 'cancel' }],
      elicitation,
    });
    await this.eventWriter.append(context.threadId, {
      id: this.ids.id('event'),
      threadId: context.threadId,
      turnId: context.turnId,
      type: 'approval.requested',
      createdAt: approval.createdAt,
      payload: { approval },
    });

    let answer: AnswerRuntimeApprovalInput;
    try {
      answer = await waitWithSignal(this.approvalGate.waitForDecision(approval.id), context.signal);
    } catch (error) {
      const message = abortMessage(error);
      const resolved = await this.approvalGate.answerApproval(approval.id, {
        decision: 'cancel',
        elicitationResponse: { action: 'cancel' },
        message,
      });
      await this.publishResolved(context, approval.id, 'cancel', message, resolved.resolvedAt);
      this.approvalGate.forgetApproval(approval.id);
      throw error;
    }

    try {
      await this.publishResolved(context, approval.id, answer.decision, answer.message);
      return elicitationResult(answer.elicitationResponse);
    } finally {
      // Form values may contain credentials or personal data. Once the waiting
      // protocol request consumes them there is no reason to retain them.
      this.approvalGate.forgetApproval(approval.id);
    }
  }

  private async publishResolved(
    context: McpElicitationExecutionContext,
    approvalId: string,
    decision: AnswerRuntimeApprovalInput['decision'],
    message?: string,
    createdAt?: string,
  ): Promise<void> {
    await this.eventWriter.append(context.threadId, {
      id: this.ids.id('event'),
      threadId: context.threadId,
      turnId: context.turnId,
      type: 'approval.resolved',
      createdAt: createdAt ?? this.clock.now().toISOString(),
      payload: { approvalId, decision, ...(message ? { message } : {}) },
    });
  }
}

function normalizeElicitation(serverKey: string, params: ElicitRequest['params']): RuntimeMcpElicitation {
  assertBoundedText(params.message, MAX_MESSAGE_BYTES, 'MCP elicitation message');
  if (params.mode === 'url') {
    assertBoundedText(params.url, MAX_ELICITATION_URL_BYTES, 'MCP elicitation URL');
    const url = secureElicitationUrl(params.url);
    return {
      mode: 'url',
      serverKey,
      message: params.message,
      displayUrl: `${url.origin}${url.pathname}`,
      elicitationId: params.elicitationId,
    };
  }

  const schemaJson = JSON.stringify(params.requestedSchema);
  assertBoundedText(schemaJson, MAX_SCHEMA_BYTES, 'MCP elicitation schema');
  if (Object.keys(params.requestedSchema.properties).length > MAX_FORM_FIELDS) {
    throw new Error(`MCP elicitation form exceeds ${MAX_FORM_FIELDS} fields.`);
  }
  return {
    mode: 'form',
    serverKey,
    message: params.message,
    requestedSchema: structuredClone(params.requestedSchema) as RuntimeMcpElicitationSchema,
  };
}

export function secureElicitationUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('MCP elicitation URLs must use HTTPS or loopback HTTP.');
  }
  if (url.username || url.password) throw new Error('MCP elicitation URLs cannot contain embedded credentials.');
  return url;
}

function elicitationPreview(elicitation: RuntimeMcpElicitation): string {
  if (elicitation.mode === 'url') {
    return JSON.stringify({ server: elicitation.serverKey, url: elicitation.displayUrl });
  }
  return JSON.stringify({
    server: elicitation.serverKey,
    fields: Object.keys(elicitation.requestedSchema.properties),
  });
}

function elicitationResult(response: RuntimeMcpElicitationResponse | undefined): ElicitResult {
  if (!response) throw new Error('MCP elicitation response is missing.');
  return {
    action: response.action,
    ...(response.action === 'accept' && response.content ? { content: response.content } : {}),
  };
}

function assertBoundedText(value: string, maxBytes: number, label: string): void {
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function abortMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'MCP elicitation cancelled.';
}
