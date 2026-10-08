import type { Model } from '@earendil-works/pi-ai';
import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { PiApi } from './pi-context.js';

const RESPONSE_FORMAT_ERROR_PATTERN = /\b(?:response[_ -]?format|json[_ -]?schema|json[_ -]?object|structured output)\b/iu;
const ANTHROPIC_OUTPUT_CONFIG_ERROR_PATTERN = /\boutput[_ -]?config\b/iu;

/** Request-local transport corrections; never persist these as model/user settings. */
export type PiModelRequest = ModelRequest & {
  anthropicThinkingMode?: 'adaptive' | 'default';
};

/**
 * Pi exposes canonical provider identity, while response-format support still
 * lives outside its current sampling API. Apply only capabilities that are
 * known from that identity; unknown compatible services are tried
 * optimistically and can degrade after a provider validation error.
 */
export function withKnownPiRequestCompatibility(
  request: ModelRequest,
  model: Model<PiApi>,
): PiModelRequest {
  if (model.api === 'anthropic-messages' && model.reasoning
    && model.thinkingLevelMap?.off === null && !request.thinking) {
    // Turning thinking off is only a preference when the model cannot disable it.
    return { ...request, anthropicThinkingMode: 'default', temperature: undefined };
  }
  if (
    request.responseFormat?.schema
    && model.api === 'openai-completions'
    && model.provider === 'deepseek'
  ) {
    return withoutResponseSchema(request);
  }
  return request;
}

/**
 * Provider-compatible endpoints often accept only a subset of the protocol.
 * Retry validation failures by removing one optional constraint at a time;
 * unrelated failures and requests that already emitted output are not retried.
 */
export function nextPiCompatibilityRetry(
  request: PiModelRequest,
  error: unknown,
  api: PiApi,
): PiModelRequest | null {
  const details = providerErrorDetails(error).toLowerCase();
  const thinkingRetry = anthropicThinkingRetry(request, error, details, api);
  // Thinking errors may mention output_config.effort; that does not invalidate
  // the caller's independent output_config.format/schema constraint.
  if (thinkingRetry) return thinkingRetry;
  let next = request;
  if (shouldRetryWithoutTemperature(request, details)) {
    next = { ...next, temperature: undefined };
  }
  if (shouldRetryWithWeakerResponseFormat(request, error, details, api)) {
    next = weakerResponseFormat(next, api);
  }
  return next === request ? null : next;
}

function anthropicThinkingRetry(
  request: PiModelRequest,
  error: unknown,
  details: string,
  api: PiApi,
): PiModelRequest | null {
  const status = providerHttpStatus(error);
  // SSE errors arrive after HTTP 200, so Pi preserves the validation type but no failing HTTP status.
  const validationError = status === 400 || status === 422
    || (status === undefined && /\binvalid_request_error\b/u.test(details));
  if (api !== 'anthropic-messages' || !validationError || !details.includes('not supported')) {
    return null;
  }
  if (request.thinking && request.anthropicThinkingMode !== 'adaptive'
    && details.includes('thinking.type.enabled') && details.includes('thinking.type.adaptive')) {
    return { ...request, anthropicThinkingMode: 'adaptive' };
  }
  if (!request.thinking && request.anthropicThinkingMode !== 'default' && details.includes('thinking.type.disabled')) {
    // Always-on models must choose their own thinking mode, including defaults
    // that disallow the title task's otherwise valid sampling temperature.
    return { ...request, anthropicThinkingMode: 'default', temperature: undefined };
  }
  return null;
}

export function piResponseFormatPayload(
  payload: unknown,
  request: ModelRequest,
  api: PiApi,
): unknown {
  if (
    request.responseFormat?.type !== 'json'
    || !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
  ) {
    return undefined;
  }
  const body = { ...(payload as Record<string, unknown>) };
  const schema = request.responseFormat.schema;
  const name = request.responseFormat.name || 'setsuna_response';
  if (api === 'anthropic-messages') {
    // Anthropic has no schema-less JSON mode. The caller's prompt remains the
    // fallback when this endpoint cannot enforce the requested schema.
    if (!schema) return undefined;
    body.output_config = {
      ...objectRecord(body.output_config),
      format: { type: 'json_schema', schema },
    };
    return body;
  }
  if (api === 'openai-responses') {
    body.text = {
      ...objectRecord(body.text),
      format: schema
        ? {
            type: 'json_schema',
            name,
            schema,
            strict: true,
            ...(request.responseFormat.description
              ? { description: request.responseFormat.description }
              : {}),
          }
        : { type: 'json_object' },
    };
    return body;
  }
  body.response_format = schema
    ? {
        type: 'json_schema',
        json_schema: {
          name,
          schema,
          strict: true,
          ...(request.responseFormat.description
            ? { description: request.responseFormat.description }
            : {}),
        },
      }
    : { type: 'json_object' };
  return body;
}

function shouldRetryWithoutTemperature(
  request: Pick<ModelRequest, 'temperature'>,
  details: string,
): boolean {
  if (typeof request.temperature !== 'number') return false;
  return details.includes('temperature')
    && /\b(?:invalid|unsupported|deprecated|not supported|not allowed|only|must(?:\s+be)?|does not support|unknown|unrecognized)\b/u.test(details);
}

function shouldRetryWithWeakerResponseFormat(
  request: Pick<ModelRequest, 'responseFormat'>,
  error: unknown,
  details: string,
  api: PiApi,
): boolean {
  if (!request.responseFormat) return false;
  const status = providerHttpStatus(error);
  const formatError = RESPONSE_FORMAT_ERROR_PATTERN.test(details)
    || (api === 'anthropic-messages' && ANTHROPIC_OUTPUT_CONFIG_ERROR_PATTERN.test(details)
      && !details.includes('output_config.effort') && !details.includes('thinking.type'));
  return (status === 400 || status === 422) && formatError;
}

function weakerResponseFormat(request: ModelRequest, api: PiApi): ModelRequest {
  const responseFormat = request.responseFormat;
  if (!responseFormat) return request;
  if (responseFormat.schema && api !== 'anthropic-messages') return withoutResponseSchema(request);
  return { ...request, responseFormat: undefined };
}

function withoutResponseSchema(request: ModelRequest): ModelRequest {
  const responseFormat = request.responseFormat;
  if (!responseFormat?.schema) return request;
  const { schema: _schema, ...schemaLessFormat } = responseFormat;
  return { ...request, responseFormat: schemaLessFormat };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerHttpStatus(value: unknown, seen = new Set<object>(), depth = 0): number | undefined {
  if (depth > 4 || !value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (typeof record.status === 'number' && Number.isInteger(record.status)) return record.status;
  return providerHttpStatus(record.cause, seen, depth + 1);
}

function providerErrorDetails(value: unknown, seen = new Set<object>(), depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const record = value as Record<string, unknown>;
  return ['name', 'message', 'type', 'responseBody', 'data', 'error', 'cause']
    .map((key) => providerErrorDetails(record[key], seen, depth + 1))
    .filter(Boolean)
    .join(' ');
}
