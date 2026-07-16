import type {
  AnswerRuntimeApprovalInput,
  RuntimeStructuredInputField,
  RuntimeStructuredInputOption,
  RuntimeStructuredInputSchema,
  RuntimeStructuredInputValue,
  RuntimeToolDefinition,
  RuntimeUserInputRequest,
  RuntimeUserInputResponse,
} from '@setsuna-desktop/contracts';
import type { RuntimeEventWriter } from '../../loop/runtime-event-writer.js';
import type { ApprovalGate } from '../../ports/approval-gate.js';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import { objectInput, requiredStringArg } from './tool-input.js';

export const REQUEST_USER_INPUT_TOOL_NAME = 'request_user_input';

const MAX_TITLE_BYTES = 256;
const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_FIELD_TEXT_BYTES = 4 * 1024;
const MAX_FIELDS = 10;
const MAX_OPTIONS = 20;
const MIN_AUTO_RESOLUTION_MS = 60_000;
const MAX_AUTO_RESOLUTION_MS = 240_000;

const REQUEST_USER_INPUT_TOOL: RuntimeToolDefinition = {
  name: REQUEST_USER_INPUT_TOOL_NAME,
  description: 'Pause and ask the user for structured choices or form values. Use only when the answer materially changes the result. Never request passwords, API keys, tokens, or other secrets.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Short form title.' },
      message: { type: 'string', description: 'Why this input is needed.' },
      fields: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_FIELDS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', description: 'Stable field id using letters, digits, underscore, or hyphen.' },
            label: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['text', 'textarea', 'number', 'integer', 'boolean', 'select', 'multiselect'] },
            required: { type: 'boolean' },
            default: {},
            placeholder: { type: 'string' },
            format: { type: 'string', enum: ['date', 'date-time', 'email', 'uri'] },
            minimum: { type: 'number' },
            maximum: { type: 'number' },
            min_length: { type: 'integer', minimum: 0 },
            max_length: { type: 'integer', minimum: 1 },
            min_items: { type: 'integer', minimum: 0 },
            max_items: { type: 'integer', minimum: 1 },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: MAX_OPTIONS,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  value: { type: 'string' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['value', 'label'],
              },
            },
          },
          required: ['id', 'label', 'type'],
        },
      },
      auto_resolution_ms: {
        type: 'integer',
        minimum: MIN_AUTO_RESOLUTION_MS,
        maximum: MAX_AUTO_RESOLUTION_MS,
        description: 'Optional 60-240 second timeout. On timeout, explicit field defaults are returned and work continues.',
      },
    },
    required: ['message', 'fields'],
  },
};

type WaitOutcome =
  | { type: 'answer'; answer: AnswerRuntimeApprovalInput }
  | { type: 'timeout' };

/** Owns the audited pause/resume lifecycle for model-requested structured user input. */
export class UserInputToolHost implements ToolHost {
  constructor(
    private readonly approvals: ApprovalGate,
    private readonly events: RuntimeEventWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return context.features?.default_mode_request_user_input === false ? [] : [REQUEST_USER_INPUT_TOOL];
  }

  toolRuntimeProfile(name: string) {
    if (name !== REQUEST_USER_INPUT_TOOL_NAME) return null;
    return {
      exposure: 'direct' as const,
      supportsParallel: false,
      waitsForRuntimeCancellation: true,
      approvalMode: 'selfManaged' as const,
    };
  }

  systemPrompt(_context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): string | null {
    if (!request?.tools.some((tool) => tool.name === REQUEST_USER_INPUT_TOOL_NAME)) return null;
    return [
      'Use request_user_input only when missing user input materially changes the result and cannot be safely inferred.',
      'Keep forms short, provide concrete options when possible, and never ask for passwords, API keys, tokens, or other secrets.',
      'Set auto_resolution_ms only for non-blocking questions where continuing with explicit defaults is acceptable.',
    ].join(' ');
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (name !== REQUEST_USER_INPUT_TOOL_NAME) throw new Error(`Unknown user input tool: ${name}`);
    const turnId = requiredExecutionId(context.turnId, 'turnId');
    const toolCallId = requiredExecutionId(context.toolCallId, 'toolCallId');
    const request = normalizeUserInputRequest(input, this.clock.now());
    const approval = await this.approvals.createApproval({
      threadId: context.threadId,
      turnId,
      toolCallId,
      toolName: name,
      reason: request.message,
      argumentsPreview: JSON.stringify({
        title: request.title,
        fields: Object.keys(request.requestedSchema.properties),
        autoResolutionMs: request.autoResolutionMs,
      }),
      availableDecisions: [{ type: 'approve' }, { type: 'reject' }],
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
      const outcome = await waitForAnswer(
        this.approvals.waitForDecision(approval.id),
        context.signal,
        request.autoResolutionMs,
      );
      if (outcome.type === 'timeout') {
        const timeoutAnswer: AnswerRuntimeApprovalInput = {
          decision: 'approve',
          userInputResponse: {
            action: 'timeout',
            values: explicitDefaults(request.requestedSchema),
          },
          message: 'User input timed out and was resolved automatically.',
        };
        await this.approvals.answerApproval(approval.id, timeoutAnswer);
        // A user answer can race the deadline by a few milliseconds. Reading
        // back the gate's winner keeps the first resolution authoritative.
        answer = await this.approvals.waitForDecision(approval.id);
      } else {
        answer = outcome.answer;
      }
    } catch (error) {
      const message = abortMessage(error);
      const resolved = await this.approvals.answerApproval(approval.id, {
        decision: 'cancel',
        userInputResponse: { action: 'cancel' },
        message,
      });
      await this.publishResolved(context.threadId, turnId, approval.id, 'cancel', message, resolved.resolvedAt);
      this.approvals.forgetApproval(approval.id);
      throw error;
    }

    try {
      await this.publishResolved(context.threadId, turnId, approval.id, answer.decision, answer.message);
      return userInputResult(answer.userInputResponse);
    } finally {
      // Answers are copied only into the normal tool result; the in-memory
      // approval record no longer needs to retain potentially personal values.
      this.approvals.forgetApproval(approval.id);
    }
  }

  private async publishResolved(
    threadId: string,
    turnId: string,
    approvalId: string,
    decision: AnswerRuntimeApprovalInput['decision'],
    message?: string,
    createdAt?: string,
  ): Promise<void> {
    await this.events.append(threadId, {
      id: this.ids.id('event'),
      threadId,
      turnId,
      type: 'approval.resolved',
      createdAt: createdAt ?? this.clock.now().toISOString(),
      payload: { approvalId, decision, ...(message ? { message } : {}) },
    });
  }
}

function normalizeUserInputRequest(input: unknown, now: Date): RuntimeUserInputRequest {
  const args = objectInput(input);
  const title = optionalBoundedString(args.title, MAX_TITLE_BYTES, 'title');
  const message = boundedString(requiredStringArg(args.message, 'message'), MAX_MESSAGE_BYTES, 'message');
  if (!Array.isArray(args.fields) || !args.fields.length || args.fields.length > MAX_FIELDS) {
    throw new Error(`fields must contain between 1 and ${MAX_FIELDS} entries.`);
  }
  const properties: Record<string, RuntimeStructuredInputField> = {};
  const required: string[] = [];
  for (const [index, rawField] of args.fields.entries()) {
    const field = normalizeField(rawField, index);
    if (properties[field.id]) throw new Error(`Duplicate user input field id: ${field.id}`);
    properties[field.id] = field.schema;
    if (field.required) required.push(field.id);
  }
  const autoResolutionMs = optionalTimeout(args.auto_resolution_ms ?? args.autoResolutionMs);
  return {
    ...(title ? { title } : {}),
    message,
    requestedSchema: {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
    },
    ...(autoResolutionMs ? {
      autoResolutionMs,
      expiresAt: new Date(now.getTime() + autoResolutionMs).toISOString(),
    } : {}),
  };
}

function normalizeField(value: unknown, index: number): {
  id: string;
  required: boolean;
  schema: RuntimeStructuredInputField;
} {
  const field = objectInput(value);
  const id = requiredStringArg(field.id, `fields[${index}].id`);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(id)) {
    throw new Error(`fields[${index}].id must start with a letter and contain only letters, digits, underscores, or hyphens.`);
  }
  const label = boundedString(requiredStringArg(field.label, `fields[${index}].label`), MAX_FIELD_TEXT_BYTES, `fields[${index}].label`);
  const type = requiredStringArg(field.type, `fields[${index}].type`);
  const description = optionalBoundedString(field.description, MAX_FIELD_TEXT_BYTES, `fields[${index}].description`);
  const placeholder = optionalBoundedString(field.placeholder, MAX_FIELD_TEXT_BYTES, `fields[${index}].placeholder`);
  const options = type === 'select' || type === 'multiselect' ? normalizeOptions(field.options, index) : undefined;
  if (field.options !== undefined && !options) throw new Error(`fields[${index}].options is only valid for select fields.`);
  const schema = fieldSchema(type, field, { label, description, placeholder, options }, index);
  validateDefault(id, schema, field.default);
  if (field.default !== undefined) schema.default = structuredClone(field.default) as RuntimeStructuredInputValue;
  return { id, required: field.required === true, schema };
}

function fieldSchema(
  type: string,
  input: Record<string, unknown>,
  metadata: {
    label: string;
    description?: string;
    placeholder?: string;
    options?: RuntimeStructuredInputOption[];
  },
  index: number,
): RuntimeStructuredInputField {
  const shared = {
    title: metadata.label,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.placeholder ? { placeholder: metadata.placeholder } : {}),
  };
  if (type === 'text' || type === 'textarea') {
    const format = optionalFormat(input.format, index);
    return {
      type: 'string',
      ...shared,
      ...(type === 'textarea' ? { multiline: true } : {}),
      ...(format ? { format } : {}),
      ...optionalLengthBounds(input, index),
    };
  }
  if (type === 'number' || type === 'integer') {
    return {
      type,
      ...shared,
      ...optionalNumericBounds(input, index),
    };
  }
  if (type === 'boolean') return { type: 'boolean', ...shared };
  if (type === 'select') return { type: 'string', ...shared, oneOf: metadata.options };
  if (type === 'multiselect') {
    return {
      type: 'array',
      ...shared,
      items: { anyOf: metadata.options },
      ...optionalItemBounds(input, index),
    };
  }
  throw new Error(`Unsupported fields[${index}].type: ${type}`);
}

function normalizeOptions(value: unknown, fieldIndex: number): RuntimeStructuredInputOption[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_OPTIONS) {
    throw new Error(`fields[${fieldIndex}].options must contain between 2 and ${MAX_OPTIONS} entries.`);
  }
  const seen = new Set<string>();
  return value.map((rawOption, optionIndex) => {
    const option = objectInput(rawOption);
    const constValue = boundedString(requiredStringArg(option.value, `fields[${fieldIndex}].options[${optionIndex}].value`), MAX_FIELD_TEXT_BYTES, 'option value');
    if (seen.has(constValue)) throw new Error(`Duplicate option value in fields[${fieldIndex}]: ${constValue}`);
    seen.add(constValue);
    const title = boundedString(requiredStringArg(option.label, `fields[${fieldIndex}].options[${optionIndex}].label`), MAX_FIELD_TEXT_BYTES, 'option label');
    const description = optionalBoundedString(option.description, MAX_FIELD_TEXT_BYTES, 'option description');
    return { const: constValue, title, ...(description ? { description } : {}) };
  });
}

function validateDefault(id: string, field: RuntimeStructuredInputField, value: unknown): void {
  if (value === undefined) return;
  if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Default for '${id}' must be a boolean.`);
  if ((field.type === 'number' || field.type === 'integer') && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`Default for '${id}' must be a finite number.`);
  }
  if (field.type === 'integer' && !Number.isInteger(value)) throw new Error(`Default for '${id}' must be an integer.`);
  if (field.type === 'string' && typeof value !== 'string') throw new Error(`Default for '${id}' must be a string.`);
  if (field.type === 'array' && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) {
    throw new Error(`Default for '${id}' must be a string array.`);
  }
  const allowed = new Set(field.oneOf?.map((option) => option.const) ?? field.items?.anyOf?.map((option) => option.const) ?? []);
  const values = Array.isArray(value) ? value : [value];
  if (allowed.size && values.some((item) => typeof item !== 'string' || !allowed.has(item))) {
    throw new Error(`Default for '${id}' is not one of its options.`);
  }
  if (typeof value === 'string') {
    boundedString(value, MAX_FIELD_TEXT_BYTES, `Default for '${id}'`);
    if (field.minLength !== undefined && value.length < field.minLength) throw new Error(`Default for '${id}' is shorter than min_length.`);
    if (field.maxLength !== undefined && value.length > field.maxLength) throw new Error(`Default for '${id}' is longer than max_length.`);
  }
  if (typeof value === 'number') {
    if (field.minimum !== undefined && value < field.minimum) throw new Error(`Default for '${id}' is below minimum.`);
    if (field.maximum !== undefined && value > field.maximum) throw new Error(`Default for '${id}' is above maximum.`);
  }
  if (Array.isArray(value)) {
    for (const item of value) boundedString(item, MAX_FIELD_TEXT_BYTES, `Default for '${id}'`);
    if (field.minItems !== undefined && value.length < field.minItems) throw new Error(`Default for '${id}' has fewer than min_items selections.`);
    if (field.maxItems !== undefined && value.length > field.maxItems) throw new Error(`Default for '${id}' has more than max_items selections.`);
  }
}

function explicitDefaults(schema: RuntimeStructuredInputSchema): Record<string, RuntimeStructuredInputValue> {
  return Object.fromEntries(Object.entries(schema.properties).flatMap(([id, field]) =>
    field.default === undefined ? [] : [[id, structuredClone(field.default)] as const],
  ));
}

function userInputResult(response: RuntimeUserInputResponse | undefined): ToolExecutionResult {
  if (!response) throw new Error('User input response is missing.');
  const values = response.values ?? {};
  if (response.action === 'submit') {
    return {
      content: `User submitted structured input:\n${JSON.stringify(values, null, 2)}`,
      preview: '用户已提交输入',
      data: { action: response.action, values },
    };
  }
  if (response.action === 'timeout') {
    return {
      content: Object.keys(values).length
        ? `User input timed out. Continue with these explicit defaults:\n${JSON.stringify(values, null, 2)}`
        : 'User input timed out without an answer or explicit defaults. Continue with best judgment.',
      preview: '用户输入已超时',
      data: { action: response.action, values },
    };
  }
  return {
    content: response.action === 'decline' ? 'User declined to provide this input.' : 'User input was cancelled.',
    preview: response.action === 'decline' ? '用户跳过了输入' : '用户输入已取消',
    data: { action: response.action },
  };
}

function waitForAnswer(
  answer: Promise<AnswerRuntimeApprovalInput>,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<WaitOutcome> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve({ type: 'timeout' });
    }, timeoutMs);
    timer?.unref?.();
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortReason(signal!)));
    signal?.addEventListener('abort', onAbort, { once: true });
    answer.then(
      (value) => finish(() => resolve({ type: 'answer', answer: value })),
      (error) => finish(() => reject(error)),
    );
  });
}

function optionalTimeout(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < MIN_AUTO_RESOLUTION_MS || (value as number) > MAX_AUTO_RESOLUTION_MS) {
    throw new Error(`auto_resolution_ms must be an integer between ${MIN_AUTO_RESOLUTION_MS} and ${MAX_AUTO_RESOLUTION_MS}.`);
  }
  return value as number;
}

function optionalFormat(value: unknown, index: number): RuntimeStructuredInputField['format'] {
  if (value === undefined) return undefined;
  if (value === 'date' || value === 'date-time' || value === 'email' || value === 'uri') return value;
  throw new Error(`Unsupported fields[${index}].format: ${String(value)}`);
}

function optionalLengthBounds(input: Record<string, unknown>, index: number) {
  const minLength = optionalNonNegativeInteger(input.min_length ?? input.minLength, `fields[${index}].min_length`);
  const maxLength = optionalPositiveInteger(input.max_length ?? input.maxLength, `fields[${index}].max_length`);
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) throw new Error(`fields[${index}] has min_length greater than max_length.`);
  return { ...(minLength !== undefined ? { minLength } : {}), ...(maxLength !== undefined ? { maxLength } : {}) };
}

function optionalNumericBounds(input: Record<string, unknown>, index: number) {
  const minimum = optionalFiniteNumber(input.minimum, `fields[${index}].minimum`);
  const maximum = optionalFiniteNumber(input.maximum, `fields[${index}].maximum`);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) throw new Error(`fields[${index}] has minimum greater than maximum.`);
  return { ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) };
}

function optionalItemBounds(input: Record<string, unknown>, index: number) {
  const minItems = optionalNonNegativeInteger(input.min_items ?? input.minItems, `fields[${index}].min_items`);
  const maxItems = optionalPositiveInteger(input.max_items ?? input.maxItems, `fields[${index}].max_items`);
  if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) throw new Error(`fields[${index}] has min_items greater than max_items.`);
  return { ...(minItems !== undefined ? { minItems } : {}), ...(maxItems !== undefined ? { maxItems } : {}) };
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value as number;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}

function optionalBoundedString(value: unknown, maxBytes: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return boundedString(value.trim(), maxBytes, label);
}

function boundedString(value: string, maxBytes: number, label: string): string {
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  return value;
}

function requiredExecutionId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`request_user_input requires runtime ${label}.`);
  return value;
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'User input cancelled with the turn.');
  error.name = 'AbortError';
  return error;
}

function abortMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'User input cancelled with the turn.';
}
