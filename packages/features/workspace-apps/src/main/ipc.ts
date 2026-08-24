import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { WORKSPACE_APPS_IPC_CHANNELS } from '../contracts/index.js';
import { listWorkspaceApps, openWorkspaceApp } from './apps.js';

const handlerChannels = [
  WORKSPACE_APPS_IPC_CHANNELS.list,
  WORKSPACE_APPS_IPC_CHANNELS.open,
] as const;

export function registerWorkspaceAppsIpc(scope: FeatureScope): () => void {
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);

  registerScopedHandler(scope, WORKSPACE_APPS_IPC_CHANNELS.list, (_event, value) => {
    const input = inputRecord(value);
    return listWorkspaceApps(String(input.workspaceRoot ?? ''));
  });
  registerScopedHandler(scope, WORKSPACE_APPS_IPC_CHANNELS.open, (_event, value) => {
    const input = inputRecord(value);
    return openWorkspaceApp({
      appId: String(input.appId ?? ''),
      filePath: input.filePath == null ? null : String(input.filePath),
      line: typeof input.line === 'number' && Number.isFinite(input.line) ? input.line : null,
      workspaceRoot: String(input.workspaceRoot ?? ''),
    });
  });

  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
  };
}

type WorkspaceAppsIpcHandler = (
  event: IpcMainInvokeEvent,
  input: unknown,
) => unknown | PromiseLike<unknown>;

function registerScopedHandler(
  scope: FeatureScope,
  channel: string,
  handler: WorkspaceAppsIpcHandler,
): void {
  ipcMain.handle(channel, (event, input: unknown) => (
    scope.runOperation(() => handler(event, input))
  ));
}

function inputRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}
