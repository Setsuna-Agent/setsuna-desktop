import type {
  FeatureOperationDescriptor,
  FeatureOperationErrorDefinitions,
  FeatureOperationMethod,
} from '@setsuna-desktop/feature-core/operation';
import {
  FeatureOperationFailure,
  KERNEL_FEATURE_OPERATION_ERRORS,
  featureOperationPatternKey,
} from '@setsuna-desktop/feature-core/operation';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import {
  FeatureOperationCancelledError,
  FeatureScopeUnavailableError,
} from '@setsuna-desktop/feature-core/status';
import type {
  RuntimeFeatureRouteHandlerContext,
  RuntimeRouteRegistrar,
} from '@setsuna-desktop/feature-core/runtime';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { readBody, sendJson } from '../../server/http-utils.js';

type RouteRegistration = {
  method: FeatureOperationMethod;
  operation: FeatureOperationDescriptor<unknown, unknown, FeatureOperationErrorDefinitions>;
  patternKey: string;
  scope: FeatureScope;
  segments: readonly string[];
  specificity: number;
  invoke(input: unknown, context: RuntimeFeatureRouteHandlerContext): Promise<unknown>;
};

export class RuntimeRouteRegistry implements RuntimeRouteRegistrar {
  private readonly registrations = new Set<RouteRegistration>();

  register<TInput, TOutput, TErrors extends FeatureOperationErrorDefinitions>(
    scope: FeatureScope,
    operation: FeatureOperationDescriptor<TInput, TOutput, TErrors>,
    handler: (
      input: TInput,
      context: RuntimeFeatureRouteHandlerContext,
    ) => TOutput | PromiseLike<TOutput>,
  ): Readonly<{ dispose(): void }> {
    const patternKey = featureOperationPatternKey(operation.method, operation.path);
    if ([...this.registrations].some((registration) => registration.patternKey === patternKey)) {
      throw new Error(`Feature route conflict for ${patternKey}.`);
    }
    const segments = operation.path.slice(1).split('/');
    const registration: RouteRegistration = {
      method: operation.method,
      operation: operation as FeatureOperationDescriptor<unknown, unknown, FeatureOperationErrorDefinitions>,
      patternKey,
      scope,
      segments,
      specificity: segments.filter((segment) => !segment.startsWith(':')).length,
      invoke: async (value, context) => handler(parseOperationInput(operation.input, value), context),
    };
    this.registrations.add(registration);
    let disposed = false;
    const contribution = Object.freeze({
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.registrations.delete(registration);
      },
    });
    scope.add(contribution.dispose);
    return contribution;
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const method = request.method as FeatureOperationMethod | undefined;
    if (!method) return false;
    const matched = [...this.registrations]
      .filter((registration) => registration.method === method)
      .map((registration) => ({
        registration,
        parameters: matchRoute(registration.segments, url.pathname),
      }))
      .filter((match): match is { registration: RouteRegistration; parameters: Record<string, string> } => (
        match.parameters !== null
      ))
      .sort((left, right) => right.registration.specificity - left.registration.specificity)[0];
    if (!matched) return false;

    const { operation, scope } = matched.registration;
    const requestAbort = new AbortController();
    const abortOperation = () => {
      if (!requestAbort.signal.aborted) {
        requestAbort.abort(new FeatureOperationCancelledError());
      }
    };
    const abortOnResponseClose = () => {
      if (!response.writableEnded) abortOperation();
    };
    request.once('aborted', abortOperation);
    response.once('close', abortOnResponseClose);
    try {
      const rawInput = await routeInput(request, url, matched.parameters);
      const output = await scope.runOperation(
        (signal) => matched.registration.invoke(rawInput, { signal }),
        { signal: requestAbort.signal },
      );
      sendJson(response, 200, operation.output.parse(output));
    } catch (error) {
      const failure = operationFailure(operation, error);
      sendJson(response, failure.status, {
        error: failure.error.message,
        code: failure.error.code,
        retryable: failure.error.retryable,
        ...(failure.error.details === undefined ? {} : { details: failure.error.details }),
      });
    } finally {
      request.removeListener('aborted', abortOperation);
      response.removeListener('close', abortOnResponseClose);
    }
    return true;
  }
}

function parseOperationInput<TInput>(
  codec: Readonly<{ parse(value: unknown): TInput }>,
  value: unknown,
): TInput {
  try {
    return codec.parse(value);
  } catch {
    // Codec details may contain untrusted input. Keep the transport error
    // stable and safe while preserving handler failures as INTERNAL below.
    throw new FeatureOperationFailure({
      code: 'INVALID_INPUT',
      message: 'Feature operation input is invalid.',
      retryable: false,
    });
  }
}

async function routeInput(
  request: IncomingMessage,
  url: URL,
  parameters: Readonly<Record<string, string>>,
): Promise<unknown> {
  const query = Object.fromEntries(url.searchParams.entries());
  const boundary = { ...query, ...parameters };
  if (request.method === 'GET' || request.method === 'DELETE') {
    return Object.keys(boundary).length ? boundary : undefined;
  }
  const body = await readBody<unknown>(request, undefined);
  if (!Object.keys(boundary).length) return body;
  if (body === undefined || body === null) return boundary;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new FeatureOperationFailure({
      code: 'INVALID_INPUT',
      message: 'Feature operation input must be an object when the route contains parameters.',
      retryable: false,
    });
  }
  return { ...body, ...boundary };
}

function matchRoute(
  patternSegments: readonly string[],
  pathname: string,
): Record<string, string> | null {
  const candidateSegments = pathname.slice(1).split('/');
  if (candidateSegments.length !== patternSegments.length) return null;
  const parameters: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const pattern = patternSegments[index];
    const candidate = candidateSegments[index];
    if (!pattern.startsWith(':')) {
      if (pattern !== candidate) return null;
      continue;
    }
    try {
      parameters[pattern.slice(1)] = decodeURIComponent(candidate);
    } catch {
      return null;
    }
  }
  return parameters;
}

function operationFailure(
  operation: RouteRegistration['operation'],
  error: unknown,
): Readonly<{
  status: number;
  error: Readonly<{ code: string; message: string; retryable: boolean; details?: unknown }>;
}> {
  if (error instanceof FeatureOperationFailure) {
    const businessDefinition = operation.errors[error.code];
    const kernelDefinition = KERNEL_FEATURE_OPERATION_ERRORS[
      error.code as keyof typeof KERNEL_FEATURE_OPERATION_ERRORS
    ];
    const definition = businessDefinition ?? kernelDefinition;
    if (definition) {
      try {
        const detailsCodec = 'details' in definition ? definition.details : undefined;
        const details = error.details === undefined || !detailsCodec
          ? undefined
          : detailsCodec.parse(error.details);
        return {
          status: definition.status,
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(details === undefined ? {} : { details }),
          },
        };
      } catch {
        return internalFailure(operation.id);
      }
    }
  }
  if (error instanceof FeatureScopeUnavailableError) {
    return {
      status: KERNEL_FEATURE_OPERATION_ERRORS.FEATURE_UNAVAILABLE.status,
      error: { code: 'FEATURE_UNAVAILABLE', message: error.message, retryable: true },
    };
  }
  if (error instanceof FeatureOperationCancelledError || isAbortError(error)) {
    return {
      status: KERNEL_FEATURE_OPERATION_ERRORS.OPERATION_CANCELLED.status,
      error: { code: 'OPERATION_CANCELLED', message: 'Feature operation was cancelled.', retryable: false },
    };
  }
  if (error instanceof SyntaxError) {
    return {
      status: KERNEL_FEATURE_OPERATION_ERRORS.INVALID_INPUT.status,
      error: { code: 'INVALID_INPUT', message: 'Feature operation input is invalid.', retryable: false },
    };
  }
  return internalFailure(operation.id);
}

function internalFailure(operationId: string) {
  console.error(`[feature-route] ${operationId} failed with an internal error.`);
  return {
    status: KERNEL_FEATURE_OPERATION_ERRORS.INTERNAL.status,
    error: { code: 'INTERNAL', message: 'Feature operation failed.', retryable: false },
  } as const;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
