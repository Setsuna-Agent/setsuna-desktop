import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer } from 'electron';
import { RUNTIME_ACTIVITY_RESOURCE_CHANNEL, RUNTIME_ACTIVITY_TERMINATE_RESOURCE_CHANNEL, runtimeActivityFeature,
  type ResourceProcessTarget, type RuntimeActivityPreloadContribution } from '../contracts/index.js';

export const runtimeActivityPreloadFeature = definePreloadFeature<RuntimeActivityPreloadContribution>({
  definition: runtimeActivityFeature,
  bridgeKeys: ['runtimeActivity'],
  contribute(writer) {
    writer.set('runtimeActivity', Object.freeze({
      sampleResources: () => ipcRenderer.invoke(RUNTIME_ACTIVITY_RESOURCE_CHANNEL),
      terminateResourceProcess: (target: ResourceProcessTarget) => ipcRenderer.invoke(RUNTIME_ACTIVITY_TERMINATE_RESOURCE_CHANNEL, target),
    }));
  },
});
