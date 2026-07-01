import type { AppServerRpcResponse } from './rpc-types.js';

export class AppServerRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
  }
}

export function appServerRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): AppServerRpcResponse {
  return data === undefined ? { id, error: { code, message } } : { id, error: { code, message, data } };
}
