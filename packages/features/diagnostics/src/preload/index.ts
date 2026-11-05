import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer } from 'electron';
import { DIAGNOSTICS_CHANNELS, diagnosticsFeature, type DiagnosticsPreloadContribution } from '../contracts/index.js';

export const diagnosticsPreloadFeature = definePreloadFeature<DiagnosticsPreloadContribution>({
  definition: diagnosticsFeature,
  bridgeKeys: ['diagnostics'],
  contribute(writer) {
    writer.set('diagnostics', Object.freeze({
      getLogDirectory: () => ipcRenderer.invoke(DIAGNOSTICS_CHANNELS.directory),
      openLogDirectory: () => ipcRenderer.invoke(DIAGNOSTICS_CHANNELS.openDirectory),
    }));
  },
});
