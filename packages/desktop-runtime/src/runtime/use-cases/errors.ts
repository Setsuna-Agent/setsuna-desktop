export type RuntimeUseCaseErrorCode =
  | 'conflict'
  | 'invalid_input'
  | 'invalid_request'
  | 'mcp_server_not_found'
  | 'thread_not_found';

/**
 * Transport-neutral application error. REST and app-server adapters map the
 * stable code to their own status/error envelopes without owning the behavior.
 */
export class RuntimeUseCaseError extends Error {
  constructor(
    readonly code: RuntimeUseCaseErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RuntimeUseCaseError';
  }
}

export function runtimeUseCaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
