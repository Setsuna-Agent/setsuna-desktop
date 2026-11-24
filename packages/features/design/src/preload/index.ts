import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer } from 'electron';
import { designFeature, designMcpChannels, type DesignMcpBridge,
  type DesignMcpCanvasEvent, type DesignMcpPreloadContribution } from '../contracts/index.js';

export const designPreloadFeature = definePreloadFeature<DesignMcpPreloadContribution>({
  definition: designFeature,
  bridgeKeys: ['designMcp'],
  contribute(writer) {
    const bridge: DesignMcpBridge = {
      settings: () => ipcRenderer.invoke(designMcpChannels.settings),
      setEnabled: (client, enabled) => ipcRenderer.invoke(designMcpChannels.setEnabled, client, enabled),
      copyConfig: () => ipcRenderer.invoke(designMcpChannels.copyConfig),
      revokeManual: () => ipcRenderer.invoke(designMcpChannels.revokeManual),
      setCanvas: (canvasId, visible) => ipcRenderer.send(designMcpChannels.canvas, canvasId, visible),
      onRequest(listener) {
        const receive = (_event: unknown, request: DesignMcpCanvasEvent) => listener(request);
        ipcRenderer.on(designMcpChannels.request, receive);
        return () => { ipcRenderer.off(designMcpChannels.request, receive); };
      },
      reply: (requestId, reply) => ipcRenderer.send(designMcpChannels.reply, requestId, reply),
    };
    writer.set('designMcp', Object.freeze(bridge));
  },
});
