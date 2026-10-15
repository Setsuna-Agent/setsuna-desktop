import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getFileIcon: vi.fn(),
  icon: { isEmpty: () => false },
  fallback: { isEmpty: () => false },
}));
vi.mock('electron', () => ({
  app: { getFileIcon: mocks.getFileIcon },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { mocks.handlers.set(channel, handler); },
    removeHandler: (channel: string) => { mocks.handlers.delete(channel); },
  },
}));
vi.mock('../../../src/window/icon.js', () => ({ loadDesktopIcon: () => ({ resize: () => mocks.fallback }) }));
import { registerFileDragIpc } from '../../../src/ipc/file-drag-ipc.js';
import { desktopWindows } from '../../../src/window/registry.js';

let directory: string;
let workspaceRoot: string;
const readAttachment = vi.fn();
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'setsuna-file-drag-'));
  workspaceRoot = path.join(directory, 'workspace');
  await mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
  await writeFile(path.join(workspaceRoot, 'docs', '报告.txt'), 'original file');
  mocks.getFileIcon.mockReset().mockResolvedValue(mocks.icon);
  readAttachment.mockReset();
  registerFileDragIpc(directory, readAttachment);
});
afterEach(async () => {
  for (const window of desktopWindows.all()) window.emit('closed');
  await rm(directory, { recursive: true, force: true });
});

function createSender(id = 1, registered = true) {
  const sender = { id, mainFrame: {}, isDestroyed: vi.fn(() => false), startDrag: vi.fn() };
  if (registered) desktopWindows.add(Object.assign(new EventEmitter(), {
    webContents: sender, isDestroyed: () => false,
  }) as unknown as BrowserWindow);
  return { sender, senderFrame: sender.mainFrame };
}
const start = (event: ReturnType<typeof createSender>, input: unknown) => mocks.handlers.get('desktop:start-file-drag')!(event, input);
const fileInput = (filePath = 'docs/报告.txt') => ({ kind: 'workspace-file', workspaceRoot, filePath });

it('drags the canonical file from the requesting window without modifying the source', async () => {
  const event = createSender();
  const other = createSender(2);
  await expect(start(event, fileInput())).resolves.toEqual({ ok: true });
  const file = await realpath(path.join(workspaceRoot, 'docs', '报告.txt'));
  expect(event.sender.startDrag).toHaveBeenCalledExactlyOnceWith({ file, icon: mocks.icon });
  expect(other.sender.startDrag).not.toHaveBeenCalled();
  expect(await readFile(file, 'utf8')).toBe('original file');
  mocks.getFileIcon.mockRejectedValueOnce(new Error('No system icon'));
  await expect(start(event, fileInput())).resolves.toEqual({ ok: true });
  expect(event.sender.startDrag).toHaveBeenLastCalledWith({ file, icon: mocks.fallback });
});

it('rejects invalid, missing, directory and escaping paths before starting an OS drag', async () => {
  const event = createSender();
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'private');
  await symlink(outside, path.join(workspaceRoot, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const input of [null, { path: outside }, fileInput('missing.txt'), fileInput('docs'),
    fileInput('../outside/secret.txt'), fileInput('link/secret.txt'), fileInput(path.join(outside, 'secret.txt'))]) {
    await expect(start(event, input)).resolves.toMatchObject({ ok: false });
  }
  expect(event.sender.startDrag).not.toHaveBeenCalled();
  expect(mocks.getFileIcon).not.toHaveBeenCalled();
});

it('rejects guests, child frames and a window closed while the icon was loading', async () => {
  const event = createSender();
  const guest = createSender(2, false);
  await expect(start(guest, fileInput())).resolves.toMatchObject({ ok: false });
  await expect(start({ ...event, senderFrame: {} }, fileInput())).resolves.toMatchObject({ ok: false });
  mocks.getFileIcon.mockImplementationOnce(async () => {
    event.sender.isDestroyed.mockReturnValue(true);
    return mocks.icon;
  });
  await expect(start(event, fileInput())).resolves.toMatchObject({ ok: false });
  expect(event.sender.startDrag).not.toHaveBeenCalled();
  expect(guest.sender.startDrag).not.toHaveBeenCalled();
});

it('uses managed images and thread-authorized bytes instead of renderer URLs', async () => {
  const event = createSender();
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const assetDirectory = path.join(directory, 'runtime', 'generated-images', 'generated_image_1');
  await mkdir(assetDirectory, { recursive: true });
  await writeFile(path.join(assetDirectory, 'image.png'), bytes);
  await expect(start(event, { kind: 'image', image: { name: 'image.png', assetId: 'generated_image_1' } }))
    .resolves.toEqual({ ok: true });
  expect(event.sender.startDrag).toHaveBeenLastCalledWith({ file: await realpath(path.join(assetDirectory, 'image.png')), icon: mocks.icon });
  readAttachment.mockResolvedValueOnce({ ok: true, data: Uint8Array.from(bytes), type: 'image/png' });
  const attachment = { kind: 'image', image: { name: 'photo.png', attachment: { threadId: 'thread', assetId: 'asset' } } };
  await expect(start(event, attachment)).resolves.toEqual({ ok: true });
  expect(readAttachment).toHaveBeenCalledExactlyOnceWith('thread', 'asset');
  expect(await readFile(event.sender.startDrag.mock.lastCall![0].file)).toEqual(bytes);
  readAttachment.mockResolvedValueOnce({ ok: false, error: 'Asset is not linked to this thread.' });
  await expect(start(event, attachment)).resolves.toMatchObject({ ok: false });
  await expect(start(event, { kind: 'image', image: { name: 'secret', dataUrl: 'file:///private/secret' } }))
    .resolves.toMatchObject({ ok: false });
  expect(event.sender.startDrag).toHaveBeenCalledTimes(2);
});

it('resolves native drops only to files within the selected workspace', async () => {
  const event = createSender();
  const resolve = mocks.handlers.get('desktop:resolve-workspace-file-drop')!;
  const filePath = path.join(workspaceRoot, 'docs', '报告.txt');
  await expect(resolve(event, { workspaceRoot, filePath })).resolves.toBe('docs/报告.txt');
  const outside = path.join(directory, 'foreign.txt');
  await writeFile(outside, 'foreign');
  for (const target of [outside, workspaceRoot, path.join(workspaceRoot, 'missing.txt'), 'docs/报告.txt']) {
    await expect(resolve(event, { workspaceRoot, filePath: target })).resolves.toBeNull();
  }
  expect(resolve({ ...event, senderFrame: {} }, { workspaceRoot, filePath })).toBeNull();
});
