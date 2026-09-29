import { THREAD_DELETION_CHANNELS, type DesktopRuntimeBridge } from '@setsuna-desktop/contracts';
import { ipcRenderer } from 'electron';

export const onThreadDeletionCheck: DesktopRuntimeBridge['onThreadDeletionCheck'] = (check, finished) => {
  const handleCheck = (_event: Electron.IpcRendererEvent, requestId: string) => {
    ipcRenderer.send(THREAD_DELETION_CHANNELS.checked, { requestId, state: check() });
  };
  const handleFinished = (_event: Electron.IpcRendererEvent, result: Parameters<typeof finished>[0]) => finished(result);
  ipcRenderer.on(THREAD_DELETION_CHANNELS.check, handleCheck);
  ipcRenderer.on(THREAD_DELETION_CHANNELS.finished, handleFinished);
  return () => {
    ipcRenderer.off(THREAD_DELETION_CHANNELS.check, handleCheck);
    ipcRenderer.off(THREAD_DELETION_CHANNELS.finished, handleFinished);
  };
};
