import {
  THREAD_DELETION_CHANNELS,
  runtimeText,
  type DesktopThreadDeletionState,
  type RuntimeInterfaceLanguage,
  type RuntimeRequestInput,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { dialog, ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import type { RuntimeHost } from '../runtime/host.js';
import { desktopWindows } from './registry.js';

/** Serialize deletion so every desktop window can finish checking before any data is removed. */
export function createThreadDeletionHandler(host: Pick<RuntimeHost, 'request'>, language: () => RuntimeInterfaceLanguage) {
  let queue: Promise<unknown> = Promise.resolve();
  return (sender: WebContents, input: RuntimeRequestInput): Promise<unknown> => {
    const deletion = queue.then(() => deleteThread(sender, input));
    queue = deletion.catch(() => undefined);
    return deletion;
  };

  async function deleteThread(sender: WebContents, input: RuntimeRequestInput): Promise<unknown> {
    const window = desktopWindows.get(sender.id);
    if (!window) throw new Error('Desktop window is unavailable.');
    const threadId = decodeURIComponent(input.path.slice('/v1/threads/'.length));
    const threadIds = [threadId];
    const windows = desktopWindows.all();
    const t = runtimeText(language());
    let deleted = false;
    try {
      const states = await checkWindows(windows.map((entry) => entry.webContents));
      // Resolve open descendants from their actual parent links, including side
      // conversations that the normal thread catalog intentionally omits.
      const parents = new Map<string, string | undefined>();
      for (const state of states) {
        let id = state.threadId;
        const visited = new Set<string>();
        while (id && id !== threadId && !visited.has(id)) {
          visited.add(id);
          if (!parents.has(id)) {
            const thread = await host.request<RuntimeThread>({ path: `/v1/threads/${encodeURIComponent(id)}?messageLimit=1` });
            parents.set(id, thread.parentThreadId);
          }
          id = parents.get(id) ?? null;
        }
        if (id === threadId && state.threadId && !threadIds.includes(state.threadId)) threadIds.push(state.threadId);
      }
      const affected = states.filter((state) => state.threadId && threadIds.includes(state.threadId));
      if (affected.some((state) => state.busy)) {
        throw new Error(t('Wait for the file operation to finish before deleting this conversation.', '请等待文件操作完成后再删除对话。'));
      }
      if (affected.some((state) => state.dirty)) {
        const { response } = await dialog.showMessageBox(window, {
          type: 'warning',
          message: t('This conversation has unsaved file changes in an open window.', '此对话在已打开的窗口中有未保存的文件修改。'),
          buttons: [t('Cancel', '取消'), t('Discard changes and delete', '放弃修改并删除')],
          defaultId: 0, cancelId: 0, noLink: true,
        });
        if (response !== 1) return { cancelled: true };
      }
      if (window.isDestroyed()) return { cancelled: true };
      const result = await host.request(input);
      deleted = true;
      return result;
    } finally {
      for (const entry of windows) {
        if (!entry.webContents.isDestroyed()) {
          entry.webContents.send(THREAD_DELETION_CHANNELS.finished, { deletedThreadIds: deleted ? threadIds : [] });
        }
      }
    }
  }
}

function checkWindows(contents: WebContents[]): Promise<DesktopThreadDeletionState[]> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const pending = new Set(contents.map((sender) => sender.id));
    const states: DesktopThreadDeletionState[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.off(THREAD_DELETION_CHANNELS.checked, checked);
      for (const sender of contents) sender.off('destroyed', unavailable);
      if (error) reject(error); else resolve(states);
    };
    const unavailable = () => finish(new Error('A window became unavailable while checking unsaved file changes.'));
    const checked = (event: IpcMainEvent, reply: { requestId?: string; state?: DesktopThreadDeletionState }) => {
      if (reply?.requestId !== requestId || !pending.has(event.sender.id)) return;
      const state = reply.state;
      if (!state || (state.threadId !== null && typeof state.threadId !== 'string')
        || typeof state.dirty !== 'boolean' || typeof state.busy !== 'boolean') return;
      pending.delete(event.sender.id);
      states.push(state);
      if (!pending.size) finish();
    };
    // An unresponsive/loading renderer must never count as permission to discard its edits.
    const timer = setTimeout(() => finish(new Error('Could not check unsaved file changes in all windows. Try again.')), 5_000);
    ipcMain.on(THREAD_DELETION_CHANNELS.checked, checked);
    for (const sender of contents) {
      try {
        sender.once('destroyed', unavailable);
        sender.send(THREAD_DELETION_CHANNELS.check, requestId);
      } catch {
        unavailable();
        break;
      }
    }
    if (!pending.size) finish();
  });
}
