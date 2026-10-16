import { defineCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { app, ipcMain, webContents } from 'electron';
import { RUNTIME_ACTIVITY_RESOURCE_CHANNEL, RUNTIME_ACTIVITY_TERMINATE_RESOURCE_CHANNEL, runtimeActivityFeature } from '../contracts/index.js';
import { projectDesktopResources, terminateResourceProcess } from './resources.js';

export const runtimeActivityMainHostCapability = defineCapability<Readonly<{
  isRendererSender(senderId: number): boolean;
}>>({ id: 'runtime-activity.main-host', description: 'Trusted renderer access to process resource metrics' });

export const runtimeActivityMainFeature = defineMainFeature({
  definition: runtimeActivityFeature,
  dependencies: defineMainDependencies({ host: requiredCapability(runtimeActivityMainHostCapability) }),
  setup({ dependencies: { host }, scope }) {
    // Registration performs no sampling, enumeration or background work during startup.
    ipcMain.handle(RUNTIME_ACTIVITY_RESOURCE_CHANNEL, (event) => scope.runOperation(() => {
      if (!host.isRendererSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('Resource sampling is only available to the desktop renderer.');
      }
      return projectDesktopResources(app.getAppMetrics(), webContents.getAllWebContents(), host.isRendererSender);
    }));
    ipcMain.handle(RUNTIME_ACTIVITY_TERMINATE_RESOURCE_CHANNEL, (event, target) => scope.runOperation(() => {
      if (!host.isRendererSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('Process termination is only available to the desktop renderer.');
      }
      return terminateResourceProcess(app.getAppMetrics(), webContents.getAllWebContents(), host.isRendererSender, target);
    }));
    scope.add(() => ipcMain.removeHandler(RUNTIME_ACTIVITY_RESOURCE_CHANNEL));
    scope.add(() => ipcMain.removeHandler(RUNTIME_ACTIVITY_TERMINATE_RESOURCE_CHANNEL));
  },
});
