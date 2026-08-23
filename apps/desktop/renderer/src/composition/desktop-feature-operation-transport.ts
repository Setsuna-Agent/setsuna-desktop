import type {
  DesktopRuntimeBridge,
  RuntimeFeatureOperationResponse,
} from '@setsuna-desktop/contracts';
import {
  FeatureOperationFailure,
  featureOperationPathParameters,
  type FeatureOperationDescriptor,
  type FeatureOperationErrorDefinitions,
  type FeatureOperationTransport,
} from '@setsuna-desktop/feature-core/operation';

export function createDesktopFeatureOperationTransport(
  bridge: DesktopRuntimeBridge,
): FeatureOperationTransport {
  return Object.freeze({
    async call<TInput, TOutput, TErrors extends FeatureOperationErrorDefinitions>(
      operation: FeatureOperationDescriptor<TInput, TOutput, TErrors>,
      input: TInput,
      options: Readonly<{ signal?: AbortSignal }> = {},
    ): Promise<TOutput> {
      if (options.signal?.aborted) throw cancelledFailure();
      const parsedInput = operation.input.parse(input);
      const request = materializeOperationRequest(operation.path, parsedInput);
      const requestId = crypto.randomUUID();
      const cancel = () => {
        void bridge.cancelRequest(requestId);
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const response = await bridge.request<RuntimeFeatureOperationResponse>({
          path: request.path,
          method: operation.method,
          ...(operation.method === 'GET' || operation.method === 'DELETE' || request.body === undefined
            ? {}
            : { body: request.body }),
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
  input: unknown,
): Readonly<{ path: string; body?: unknown }> {
  const parameters = featureOperationPathParameters(routePath);
  if (!parameters.length) return Object.freeze({ path: routePath, body: input });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Feature operation path parameters require an object input.');
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
