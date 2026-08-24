import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer } from 'electron';
import {
  WORKSPACE_APPS_IPC_CHANNELS,
  workspaceAppsFeature,
  type WorkspaceAppsDesktopBridge,
  type WorkspaceAppsPreloadBridgeContribution,
} from '../contracts/index.js';

export const workspaceAppsPreloadFeature = definePreloadFeature<WorkspaceAppsPreloadBridgeContribution>({
  definition: workspaceAppsFeature,
  bridgeKeys: ['workspaceApps'],
  contribute(writer) {
    const workspaceApps: WorkspaceAppsDesktopBridge = {
      list: (workspaceRoot) => ipcRenderer.invoke(
        WORKSPACE_APPS_IPC_CHANNELS.list,
        { workspaceRoot },
      ),
      open: (workspaceRoot, appId, filePath, line) => ipcRenderer.invoke(
        WORKSPACE_APPS_IPC_CHANNELS.open,
        { appId, filePath, line, workspaceRoot },
      ),
    };
    writer.set('workspaceApps', Object.freeze(workspaceApps));
  },
});
