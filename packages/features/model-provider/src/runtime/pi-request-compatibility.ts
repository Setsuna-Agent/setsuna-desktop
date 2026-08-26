import type { Model } from '@earendil-works/pi-ai';
import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { PiApi } from './pi-context.js';

const RESPONSE_FORMAT_ERROR_PATTERN = /\b(?:response[_ -]?format|json[_ -]?schema|json[_ -]?object|structured output)\b/iu;
const ANTHROPIC_OUTPUT_CONFIG_ERROR_PATTERN = /\boutput[_ -]?config\b/iu;

/**
 * Pi exposes canonical provider identity, while response-format support still
 * lives outside its current sampling API. Apply only capabilities that are
 * known from that identity; unknown compatible services are tried
 * optimistically and can degrade after a provider validation error.
 */
export function withKnownPiRequestCompatibility(
  request: ModelRequest,
  model: Model<PiApi>,
): ModelRequest {
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
  request: ModelRequest,
  error: unknown,
  api: PiApi,
): ModelRequest | null {
  const details = providerErrorDetails(error).toLowerCase();
  let next = request;
  if (shouldRetryWithoutTemperature(request, details)) {
    next = { ...next, temperature: undefined };
  }
  if (shouldRetryWithWeakerResponseFormat(request, error, details, api)) {
    next = weakerResponseFormat(next, api);
  }
  return next === request ? null : next;
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
    && /\b(?:invalid|unsupported|not supported|not allowed|only|must(?:\s+be)?|does not support|unknown|unrecognized)\b/u.test(details);
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
    || (api === 'anthropic-messages' && ANTHROPIC_OUTPUT_CONFIG_ERROR_PATTERN.test(details));
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
  return ['name', 'message', 'responseBody', 'data', 'error', 'cause']
    .map((key) => providerErrorDetails(record[key], seen, depth + 1))
    .filter(Boolean)
    .join(' ');
}
