import type { RuntimeCodec } from './codec.js';

const OPERATION_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const ROUTE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/u;
const ROUTE_PARAMETER_PATTERN = /^:[A-Za-z][A-Za-z0-9_]*$/u;

export type FeatureOperationMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type FeatureOperationIdempotency = 'safe' | 'idempotent' | 'non-idempotent';

export const KERNEL_FEATURE_OPERATION_ERRORS = Object.freeze({
  FEATURE_UNAVAILABLE: { status: 503 },
  FEATURE_NOT_CONFIGURED: { status: 409 },
  CREDENTIALS_MISSING: { status: 409 },
  PROVIDER_UNAVAILABLE: { status: 503 },
  DEPENDENCY_UNAVAILABLE: { status: 503 },
  INVALID_INPUT: { status: 400 },
  REVISION_CONFLICT: { status: 409 },
  OPERATION_CANCELLED: { status: 499 },
  INTERNAL: { status: 500 },
} as const);

export type KernelFeatureOperationErrorCode = keyof typeof KERNEL_FEATURE_OPERATION_ERRORS;

export type FeatureOperationErrorDefinition<TDetails = never> = Readonly<{
  status: number;
  details?: RuntimeCodec<TDetails>;
}>;

export type FeatureOperationErrorDefinitions = Readonly<
  Record<string, FeatureOperationErrorDefinition<unknown>>
>;

export type FeatureOperationDescriptor<
  TInput,
  TOutput,
  TErrors extends FeatureOperationErrorDefinitions = FeatureOperationErrorDefinitions,
> = Readonly<{
  id: string;
  method: FeatureOperationMethod;
  path: string;
  input: RuntimeCodec<TInput>;
  output: RuntimeCodec<TOutput>;
  errors: TErrors;
  idempotency: FeatureOperationIdempotency;
}>;

export type FeatureOperationError<TCode extends string = string, TDetails = unknown> = Readonly<{
  code: TCode | KernelFeatureOperationErrorCode;
  message: string;
  retryable: boolean;
  details?: TDetails;
}>;

export class FeatureOperationFailure<TCode extends string = string> extends Error {
  readonly code: TCode | KernelFeatureOperationErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(input: FeatureOperationError<TCode>) {
    super(input.message);
    this.name = 'FeatureOperationFailure';
    this.code = input.code;
    this.retryable = input.retryable;
    this.details = input.details;
  }
}

export interface FeatureOperationTransport {
  call<TInput, TOutput, TErrors extends FeatureOperationErrorDefinitions>(
    operation: FeatureOperationDescriptor<TInput, TOutput, TErrors>,
    input: TInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<TOutput>;
}

export function defineFeatureOperation<
  TInput,
  TOutput,
  const TErrors extends FeatureOperationErrorDefinitions,
>(input: FeatureOperationDescriptor<TInput, TOutput, TErrors>): FeatureOperationDescriptor<TInput, TOutput, TErrors> {
  if (!OPERATION_ID_PATTERN.test(input.id)) {
    throw new Error(`Invalid Feature operation id "${input.id}".`);
  }
  validateFeatureRoutePath(input.path);
  if (!Object.values(input.errors).every(({ status }) => (
    Number.isInteger(status) && status >= 400 && status <= 599
  ))) {
    throw new Error(`Feature operation "${input.id}" contains an invalid error status.`);
  }
  return Object.freeze({
    ...input,
    errors: Object.freeze({ ...input.errors }),
  });
}

export function validateFeatureRoutePath(routePath: string): void {
  if (!routePath.startsWith('/v1/features/')) {
    throw new Error(`Feature route "${routePath}" must use the /v1/features namespace.`);
  }
  if (routePath.includes('?') || routePath.includes('#') || routePath.endsWith('/')) {
    throw new Error(`Feature route "${routePath}" must be a normalized path without query, fragment, or trailing slash.`);
  }
  const segments = routePath.slice(1).split('/');
  const parameterNames = new Set<string>();
  for (const segment of segments) {
    if (ROUTE_SEGMENT_PATTERN.test(segment)) continue;
    if (!ROUTE_PARAMETER_PATTERN.test(segment)) {
      throw new Error(`Feature route "${routePath}" contains an unsupported segment "${segment}".`);
    }
    const name = segment.slice(1);
    if (parameterNames.has(name)) {
      throw new Error(`Feature route "${routePath}" repeats parameter "${name}".`);
    }
    parameterNames.add(name);
  }
}

export function featureOperationPatternKey(
  method: FeatureOperationMethod,
  routePath: string,
): string {
  const shape = routePath
    .split('/')
    .map((segment) => segment.startsWith(':') ? ':' : segment)
    .join('/');
  return `${method} ${shape}`;
}

export function featureOperationPathParameters(routePath: string): readonly string[] {
  return Object.freeze(routePath
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1)));
}
