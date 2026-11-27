import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer, webUtils } from 'electron';
import { designFeature, designMcpChannels, designPublicationChannels as publication,
  type DesignMcpBridge, type DesignMcpCanvasEvent, type DesignMcpPreloadContribution, type DesignPublicationBridge,
  type DesignPublicationPreloadContribution } from '../contracts/index.js';

export const designPreloadFeature = definePreloadFeature<DesignMcpPreloadContribution & DesignPublicationPreloadContribution>({
  definition: designFeature,
  bridgeKeys: ['designMcp', 'designPublication'],
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
    const actions: DesignPublicationBridge = {
      async importPackage(file, destination) {
        const source = webUtils.getPathForFile(file);
        if (!source) throw new Error('Select a design package from disk.');
        return ipcRenderer.invoke(publication.importPackage, source, destination);
      },
      prepareExport: (id, input) => ipcRenderer.invoke(publication.prepareExport, id, input),
      useExportFile: (id, action) => ipcRenderer.invoke(publication.useExportFile, id, action),
      closeExport: (id) => ipcRenderer.invoke(publication.closeExport, id),
      previewStatus: () => ipcRenderer.invoke(publication.previewStatus),
      beginPreview: (input) => ipcRenderer.invoke(publication.beginPreview, input),
      appendPreviewBoard: (ticket, index, png) => ipcRenderer.invoke(publication.appendPreviewBoard, ticket, index, png),
      appendPreviewVariant: (ticket, board, variant, frame, png) => ipcRenderer.invoke(publication.appendPreviewVariant, ticket, board, variant, frame, png),
      publishPreview: (ticket) => ipcRenderer.invoke(publication.publishPreview, ticket),
      cancelPreview: (ticket) => ipcRenderer.invoke(publication.cancelPreview, ticket),
      stopPreview: (id) => ipcRenderer.invoke(publication.stopPreview, id),
    };
    writer.set('designPublication', Object.freeze(actions));
  },
});
