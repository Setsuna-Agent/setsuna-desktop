import type { ModelRequest } from '@setsuna-desktop/contracts';
import { jsonSchema, Output } from 'ai';

export function aiSdkOutputForRequest(
  request: ModelRequest,
): ReturnType<typeof Output.json> | ReturnType<typeof Output.object> | undefined {
  if (request.responseFormat?.type !== 'json') return undefined;
  if (request.responseFormat.schema) {
    return Output.object({
      schema: jsonSchema(
        request.responseFormat.schema as Parameters<typeof jsonSchema>[0],
      ),
      ...(request.responseFormat.name ? { name: request.responseFormat.name } : {}),
      ...(request.responseFormat.description
        ? { description: request.responseFormat.description }
        : {}),
    });
  }
  return Output.json({
    ...(request.responseFormat.name ? { name: request.responseFormat.name } : {}),
    ...(request.responseFormat.description
      ? { description: request.responseFormat.description }
      : {}),
  });
}

export function openAiCompatibleResponseFormatBody(
  request: ModelRequest,
): Record<string, unknown> {
  return request.responseFormat?.type === 'json'
    ? { response_format: { type: 'json_object' } }
    : {};
}
