import type { ExtensionEventContext } from '../ports/extension-runtime.js';
import type { ToolExecutionContext } from '../ports/tool-host.js';
import type { ExtensionWorkerRequestContext } from './extension-worker-client.js';

export function safeWorkerContext(context: ToolExecutionContext): Record<string, unknown> {
  return {
    threadId: context.threadId,
    ...(context.interfaceLanguage ? { interfaceLanguage: context.interfaceLanguage } : {}),
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.environment?.cwd ? { cwd: context.environment.cwd } : {}),
  };
}

export function workerRequestContext(context: ToolExecutionContext): ExtensionWorkerRequestContext {
  return {
    threadId: context.threadId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.environment?.cwd ? { cwd: context.environment.cwd } : {}),
    ...(context.environment ? { environment: context.environment } : {}),
    ...(context.permissionProfile ? { permissionProfile: context.permissionProfile } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.onToolOutputDelta ? { onOutput: (message: string) => context.onToolOutputDelta?.({ delta: message }) } : {}),
  };
}

export function safeEventContext(context: ExtensionEventContext): Record<string, unknown> {
  return {
    threadId: context.threadId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
  };
}

export function eventWorkerRequestContext(context: ExtensionEventContext): ExtensionWorkerRequestContext {
  return {
    threadId: context.threadId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
  };
}
