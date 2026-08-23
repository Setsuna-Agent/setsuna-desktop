import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  TERMINAL_IPC_CHANNELS,
  terminalFeature,
  type DesktopTerminalEvent,
  type DesktopTerminalEventPayload,
  type TerminalDesktopBridge,
  type TerminalPreloadBridgeContribution,
} from '../contracts/index.js';

export const terminalPreloadFeature = definePreloadFeature<TerminalPreloadBridgeContribution>({
  definition: terminalFeature,
  bridgeKeys: ['terminal'],
  contribute(writer) {
    const terminal: TerminalDesktopBridge = {
      open: (workspaceRoot, cols, rows) =>
        ipcRenderer.invoke(TERMINAL_IPC_CHANNELS.open, { workspaceRoot, cols, rows }),
      write: (sessionId, input) =>
        ipcRenderer.invoke(TERMINAL_IPC_CHANNELS.write, { sessionId, input }),
      read: (sessionId) => ipcRenderer.invoke(TERMINAL_IPC_CHANNELS.read, { sessionId }),
      resize: (sessionId, cols, rows) =>
        ipcRenderer.invoke(TERMINAL_IPC_CHANNELS.resize, { sessionId, cols, rows }),
      restart: (sessionId, cols, rows) =>
        ipcRenderer.invoke(TERMINAL_IPC_CHANNELS.restart, { sessionId, cols, rows }),
      close: (sessionId) => ipcRenderer.invoke(TERMINAL_IPC_CHANNELS.close, { sessionId }),
      onEvent(sessionId: string, callback: (event: DesktopTerminalEvent) => void): () => void {
        const listener = (_event: IpcRendererEvent, payload: DesktopTerminalEventPayload) => {
          if (payload.sessionId !== sessionId) return;
          callback({ seq: payload.seq, event: payload.event, data: payload.data });
        };
        ipcRenderer.on(TERMINAL_IPC_CHANNELS.event, listener);
        return () => ipcRenderer.off(TERMINAL_IPC_CHANNELS.event, listener);
      },
    };
    writer.set('terminal', Object.freeze(terminal));
  },
});
