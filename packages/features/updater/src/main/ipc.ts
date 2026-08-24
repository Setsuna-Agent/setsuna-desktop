import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { UPDATER_IPC_CHANNELS } from '../contracts/index.js';
import type { DesktopUpdater } from './updater.js';

type UpdaterIpcService = Pick<
  DesktopUpdater,
  | 'addDownloadSource'
  | 'checkAndDownload'
  | 'getState'
  | 'installReady'
  | 'promptReady'
  | 'removeDownloadSource'
  | 'selectDownloadSource'
>;

const handlerChannels = [
  UPDATER_IPC_CHANNELS.getState,
  UPDATER_IPC_CHANNELS.check,
  UPDATER_IPC_CHANNELS.addDownloadSource,
  UPDATER_IPC_CHANNELS.selectDownloadSource,
  UPDATER_IPC_CHANNELS.removeDownloadSource,
  UPDATER_IPC_CHANNELS.promptReady,
  UPDATER_IPC_CHANNELS.installReady,
] as const;

export function registerUpdaterIpc(
  scope: FeatureScope,
  updater: UpdaterIpcService,
  mainWindow: BrowserWindow,
  getInterfaceLanguage: () => RuntimeInterfaceLanguage,
): () => void {
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);

  registerScopedHandler(scope, UPDATER_IPC_CHANNELS.getState, () => updater.getState());
  registerScopedHandler(scope, UPDATER_IPC_CHANNELS.check, () => updater.checkAndDownload());
  registerScopedHandler(scope, UPDATER_IPC_CHANNELS.addDownloadSource, (_event, value) => {
    const input = inputRecord(value);
    return updater.addDownloadSource({
      name: String(input.name ?? ''),
      urlTemplate: String(input.urlTemplate ?? ''),
    });
  });
  registerScopedHandler(scope, UPDATER_IPC_CHANNELS.selectDownloadSource, (_event, sourceId) => (
    updater.selectDownloadSource(String(sourceId ?? ''))
  ));
  registerScopedHandler(scope, UPDATER_IPC_CHANNELS.removeDownloadSource, (_event, sourceId) => (
    updater.removeDownloadSource(String(sourceId ?? ''))
  ));
  registerScopedHandler(scope, UPDATER_IPC_CHANNELS.promptReady, () => (
    updater.promptReady(mainWindow, getInterfaceLanguage())
  ));
  registerScopedHandler(scope, UPDATER_IPC_CHANNELS.installReady, () => updater.installReady());

  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
  };
}

type UpdaterIpcHandler = (
  event: IpcMainInvokeEvent,
  input: unknown,
) => unknown | PromiseLike<unknown>;

function registerScopedHandler(
  scope: FeatureScope,
  channel: string,
  handler: UpdaterIpcHandler,
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
