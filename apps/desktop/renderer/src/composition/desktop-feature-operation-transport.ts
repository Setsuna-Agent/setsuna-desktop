import type {
  DesktopRuntimeBridge,
  RuntimeFeatureOperationResponse,
} from '@setsuna-desktop/contracts';
import {
  FeatureOperationFailure,
  featureOperationPathParameters,
  type FeatureOperationDescriptor,
  type FeatureOperationErrorDefinitions,
  type FeatureOperationMethod,
  type FeatureOperationTransport,
} from '@setsuna-desktop/feature-core/operation';

export function createDesktopFeatureOperationTransport(
  bridge: Pick<DesktopRuntimeBridge, 'request' | 'cancelRequest'>,
): FeatureOperationTransport {
  return Object.freeze({
    async call<TInput, TOutput, TErrors extends FeatureOperationErrorDefinitions>(
      operation: FeatureOperationDescriptor<TInput, TOutput, TErrors>,
      input: TInput,
      options: Readonly<{ signal?: AbortSignal }> = {},
    ): Promise<TOutput> {
      if (options.signal?.aborted) throw cancelledFailure();
      const parsedInput = operation.input.parse(input);
      const request = materializeOperationRequest(operation.path, operation.method, parsedInput);
      const requestId = crypto.randomUUID();
      const cancel = () => {
        void bridge.cancelRequest(requestId);
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const response = await bridge.request<RuntimeFeatureOperationResponse>({
          path: request.path,
          method: operation.method,
          ...(request.body === undefined ? {} : { body: request.body }),
          requestId,
          responseMode: 'feature-operation',
        });
        if (!response.ok) {
          throw new FeatureOperationFailure({
            code: response.error.code,
            message: response.error.message,
            retryable: response.error.retryable,
            ...('details' in response.error ? { details: response.error.details } : {}),
          });
        }
        return operation.output.parse(response.value);
      } catch (error) {
        if (options.signal?.aborted) throw cancelledFailure();
        throw error;
      } finally {
        options.signal?.removeEventListener('abort', cancel);
      }
    },
  });
}

function materializeOperationRequest(
  routePath: string,
  method: FeatureOperationMethod,
  input: unknown,
): Readonly<{ path: string; body?: unknown }> {
  const parameters = featureOperationPathParameters(routePath);
  const usesQuery = method === 'GET' || method === 'DELETE';
  if (!parameters.length && !usesQuery) return Object.freeze({ path: routePath, body: input });
  if (!parameters.length && input === undefined) return Object.freeze({ path: routePath });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Feature operation URL parameters require an object input.');
  }
  const body = { ...(input as Record<string, unknown>) };
  let path = routePath;
  for (const parameter of parameters) {
    const value = body[parameter];
    if (typeof value !== 'string' || !value) {
      throw new Error(`Feature operation path parameter "${parameter}" is invalid.`);
    }
    path = path.replace(`:${parameter}`, encodeURIComponent(value));
    delete body[parameter];
  }
  if (usesQuery) {
    // Bodyless requests must carry remaining input in the query; dropping it
    // makes renderer-validated requests fail the runtime's input codec.
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if (typeof value !== 'string' && typeof value !== 'boolean'
        && !(typeof value === 'number' && Number.isFinite(value))) {
        throw new Error(`Feature operation query parameter "${key}" must be a string, boolean, or finite number.`);
      }
      query.set(key, String(value));
    }
    return Object.freeze({ path: query.size ? `${path}?${query}` : path });
  }
  return Object.freeze({
    path,
    ...(Object.keys(body).length ? { body: Object.freeze(body) } : {}),
  });
}

function cancelledFailure(): FeatureOperationFailure {
  return new FeatureOperationFailure({
    code: 'OPERATION_CANCELLED',
    message: 'Feature operation was cancelled.',
    retryable: false,
  });
}
