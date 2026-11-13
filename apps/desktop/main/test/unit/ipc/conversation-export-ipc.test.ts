import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showSaveDialog: vi.fn(),
  getPath: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  dialog: { showSaveDialog: mocks.showSaveDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => { mocks.handlers.set(channel, handler); },
    removeHandler: (channel: string) => { mocks.handlers.delete(channel); },
  },
}));
import { registerConversationExportIpc } from '../../../src/ipc/conversation-export-ipc.js';
import { desktopWindows } from '../../../src/window/registry.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'setsuna-conversation-export-'));
  mocks.showSaveDialog.mockReset();
  mocks.getPath.mockReturnValue(directory);
  registerConversationExportIpc();
});
afterEach(async () => {
  for (const window of desktopWindows.all()) window.emit('closed');
  await rm(directory, { recursive: true, force: true });
});

function sender(registered = true, id = registered ? 1 : 2) {
  const webContents = { id, mainFrame: {}, isDestroyed: () => false };
  if (registered) desktopWindows.add(Object.assign(new EventEmitter(), {
    webContents, isDestroyed: () => false,
  }) as unknown as BrowserWindow);
  return { sender: webContents, senderFrame: webContents.mainFrame };
}
const save = (event: ReturnType<typeof sender>, input: unknown) => mocks.handlers.get('desktop:save-conversation-export')!(event, input);
const prepare = (event: ReturnType<typeof sender>, input: unknown) => mocks.handlers.get('desktop:prepare-conversation-export')!(event, input);
const savePrepared = (event: ReturnType<typeof sender>, id: unknown) => mocks.handlers.get('desktop:save-prepared-conversation-export')!(event, id);

it('only saves a prepared file for its owner and never accepts a source path from the renderer', async () => {
  const event = sender();
  const result = await prepare(event, { title: 'Selected reply', format: 'markdown', content: '# Original snapshot' }) as {
    ok: true; file: { id: string; path: string };
  };
  await expect(savePrepared(sender(true, 3), result.file.id)).resolves.toMatchObject({ ok: false });
  await expect(savePrepared(event, result.file.path)).resolves.toMatchObject({ ok: false });
  await expect(savePrepared({ ...event, senderFrame: {} }, result.file.id)).resolves.toMatchObject({ ok: false });
  expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  const destination = path.join(directory, 'renamed.md');
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
  await expect(savePrepared(event, result.file.id)).resolves.toEqual({ ok: true, file: { name: 'renamed.md', path: destination } });
  expect(await readFile(destination, 'utf8')).toBe('# Original snapshot');
});

it.each(['markdown', 'html'])('prepares a real preview file without a save dialog or accepting a renderer destination: %s', async (format) => {
  const protectedFile = path.join(directory, 'protected.txt');
  await writeFile(protectedFile, 'keep original');
  const content = '中文对话';
  const result = await prepare(sender(), { title: '../Export', format, content, path: protectedFile }) as {
    ok: true; file: { name: string; path: string };
  };
  expect(result.ok).toBe(true);
  expect(path.dirname(path.dirname(result.file.path))).toBe(directory);
  expect(path.basename(result.file.path)).toBe(result.file.name);
  expect(await readFile(result.file.path, 'utf8')).toBe(content);
  expect(await readFile(protectedFile, 'utf8')).toBe('keep original');
  expect(mocks.showSaveDialog).not.toHaveBeenCalled();
});

it.each([['markdown', 'md'], ['html', 'html']] as const)('writes UTF-8 only to the native dialog destination: %s', async (format, extension) => {
  const destination = path.join(directory, `saved.${extension}`);
  const protectedFile = path.join(directory, 'protected.txt');
  await writeFile(protectedFile, 'keep original');
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
  const content = '中文对话\n\n```ts\nconst value = "你好";\n```\n';
  await expect(save(sender(), { title: '../导出:对话?\u0000', format, content, path: protectedFile })).resolves.toEqual({ ok: true });
  expect(await readFile(destination, 'utf8')).toBe(content);
  expect(await readFile(protectedFile, 'utf8')).toBe('keep original');
  const options = mocks.showSaveDialog.mock.calls[0][1];
  expect(options.defaultPath).not.toMatch(/[<>:"/\\|?*\p{Cc}]/u);
  expect(path.extname(options.defaultPath)).toBe(`.${extension}`);
});

it('rejects guests and subframes before opening a native dialog', async () => {
  const input = { title: 'Conversation', format: 'markdown', content: 'text' };
  await expect(save(sender(false), input)).resolves.toMatchObject({ ok: false });
  await expect(prepare(sender(false), input)).resolves.toMatchObject({ ok: false });
  const event = sender();
  await expect(save({ ...event, senderFrame: {} }, input)).resolves.toMatchObject({ ok: false });
  await expect(prepare({ ...event, senderFrame: {} }, input)).resolves.toMatchObject({ ok: false });
  expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});

it('does not write on cancellation or accept an unsupported export format', async () => {
  const event = sender();
  mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: path.join(directory, 'ignored.md') });
  await expect(save(event, { title: 'CON', format: 'markdown', content: 'text' })).resolves.toEqual({ ok: true, cancelled: true });
  expect(mocks.showSaveDialog.mock.calls[0][1].defaultPath).toBe('_CON.md');
  await expect(save(event, { title: 'bad', format: 'exe', content: 'text' })).resolves.toMatchObject({ ok: false });
  expect(mocks.showSaveDialog).toHaveBeenCalledOnce();
  expect(await readdir(directory)).toEqual([]);
});

it('returns a failed save when writing the selected destination fails', async () => {
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(directory, 'missing', 'export.md') });
  await expect(save(sender(), { title: 'Conversation', format: 'markdown', content: 'text' })).resolves.toMatchObject({ ok: false });
});
