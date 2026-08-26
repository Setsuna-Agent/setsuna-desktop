import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain } from 'electron';
import {
  WINDOWS_SANDBOX_IPC_CHANNELS,
  type DesktopWindowsSandboxAction,
} from '../contracts/index.js';
import type { WindowsSandboxManager } from './manager.js';

const ACTIONS = new Set<DesktopWindowsSandboxAction>(['install', 'repair', 'uninstall']);

export function registerWindowsSandboxIpc(
  scope: FeatureScope,
  manager: WindowsSandboxManager,
  isRendererSender: (senderId: number) => boolean,
): () => void {
  const channels = [
    WINDOWS_SANDBOX_IPC_CHANNELS.getStatus,
    WINDOWS_SANDBOX_IPC_CHANNELS.runAction,
  ] as const;
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle(WINDOWS_SANDBOX_IPC_CHANNELS.getStatus, (event) => scope.runOperation(() => {
    if (!isRendererSender(event.sender.id)) {
      throw new Error('Desktop renderer is unavailable.');
    }
    return manager.getStatus();
  }));
  ipcMain.handle(WINDOWS_SANDBOX_IPC_CHANNELS.runAction, (event, value) => scope.runOperation(() => {
    if (!isRendererSender(event.sender.id)) {
      throw new Error('Desktop renderer is unavailable.');
    }
    if (!ACTIONS.has(value as DesktopWindowsSandboxAction)) {
      throw new Error('Windows sandbox action is invalid.');
    }
    return manager.runAction(value as DesktopWindowsSandboxAction);
  }));

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
