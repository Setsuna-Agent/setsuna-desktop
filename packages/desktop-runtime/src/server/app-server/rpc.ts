import type { RuntimeFactory, RuntimeServerOptions } from '../types.js';
import type { AppServerCommandExecManager } from './command-exec.js';
import { AppServerRpcError, appServerRpcError } from './errors.js';
import { appServerApprovalAnswerFromResponse } from './protocol.js';
import { dispatchAppServerRpcRequest } from './dispatcher.js';
import type { AppServerRpcRequest, AppServerRpcResponse } from './rpc-types.js';

export async function handleAppServerRpcRequest(
  runtime: RuntimeFactory,
  request: unknown,
  options: RuntimeServerOptions,
  commandExecManager: AppServerCommandExecManager,
): Promise<AppServerRpcResponse | null> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return appServerRpcError(null, -32600, 'Invalid Request');
  }
  const rawId = (request as { id?: unknown }).id;
  if (rawId !== undefined && rawId !== null && typeof rawId !== 'string' && typeof rawId !== 'number') {
    return appServerRpcError(null, -32600, 'Invalid Request');
  }
  const message = request as AppServerRpcRequest;
  const id = rawId ?? null;
  if (typeof message.method !== 'string') {
    if (message.id !== undefined && ('result' in message || 'error' in message)) {
      return await handleAppServerRpcResponseEnvelope(runtime, message);
    }
    return appServerRpcError(id, -32600, 'Invalid Request');
  }
  if (message.id === undefined) {
    if (message.method === 'initialized') return null;
    return null;
  }

  try {
    const result = await dispatchAppServerRpcRequest(runtime, message.method, message.params, options, commandExecManager);
    return { id, result };
  } catch (error) {
    if (error instanceof AppServerRpcError) return appServerRpcError(id, error.code, error.message, error.data);
    return appServerRpcError(id, -32603, error instanceof Error ? error.message : String(error));
  }
}

async function handleAppServerRpcResponseEnvelope(
  runtime: RuntimeFactory,
  request: AppServerRpcRequest,
): Promise<AppServerRpcResponse | null> {
  const approvalId = typeof request.id === 'string' ? request.id : String(request.id ?? '');
  if (!approvalId) return appServerRpcError(null, -32600, 'Invalid Request');
  try {
    const answer = appServerApprovalAnswerFromResponse(request);
    await runtime.approvalGate.answerApproval(approvalId, answer);
    return null;
  } catch (error) {
    if (error instanceof AppServerRpcError) return appServerRpcError(request.id ?? null, error.code, error.message, error.data);
    return appServerRpcError(request.id ?? null, -32603, error instanceof Error ? error.message : String(error));
  }
}
