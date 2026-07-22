import { RUNTIME_FILE_ATTACHMENT_MAX_BYTES } from '@setsuna-desktop/contracts';
import { ipcMain } from 'electron';
import type { RuntimeHost } from '../runtime/host.js';

export function registerRuntimeIpc(host: RuntimeHost): void {
  ipcMain.removeHandler('runtime:request');
  ipcMain.removeHandler('runtime:upload-attachment');
  ipcMain.removeHandler('runtime:subscribe');
  ipcMain.removeHandler('runtime:unsubscribe');
  ipcMain.handle('runtime:request', async (_event, input) => host.request(input));
  ipcMain.handle('runtime:upload-attachment', async (_event, input) => host.uploadAttachment({
    name: String(input?.name ?? ''),
    type: String(input?.type ?? ''),
    data: runtimeAttachmentBytes(input?.data),
  }));
  ipcMain.handle('runtime:subscribe', async (event, input) =>
    host.subscribeEvents(event.sender, {
      threadId: String(input?.threadId ?? ''),
      sinceSeq: typeof input?.sinceSeq === 'number' ? input.sinceSeq : undefined,
    }),
  );
  ipcMain.handle('runtime:unsubscribe', async (_event, subscriptionId) => {
    host.unsubscribe(String(subscriptionId));
  });
}

function runtimeAttachmentBytes(value: unknown): Uint8Array {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : null;
  if (!bytes) throw new Error('Attachment bytes are invalid.');
  if (bytes.byteLength > RUNTIME_FILE_ATTACHMENT_MAX_BYTES) throw new Error('Attachment is too large.');
  return bytes;
}
