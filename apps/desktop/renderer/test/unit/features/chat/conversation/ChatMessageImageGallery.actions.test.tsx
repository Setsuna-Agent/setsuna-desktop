// @vitest-environment happy-dom

import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { ChatMessageImageGallery } from '../../../../../src/features/chat/conversation/ChatMessageImageGallery.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'setsunaDesktop');
});

it('uses the visible image for preview menus and keeps thumbnail actions working', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview-image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const save = vi.fn().mockResolvedValue({ ok: true });
  const copy = vi.fn().mockResolvedValue({ ok: true });
  const reveal = vi.fn().mockResolvedValue({ ok: true });
  const read = vi.fn().mockResolvedValue({ ok: true, data: [1, 2, 3], type: 'image/png' });
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: {
    desktop: { saveImageAs: save, copyImageToClipboard: copy, revealImageInFolder: reveal, readImageAsset: read },
    runtime: { readAttachmentImage: read },
  } });
  const inline = { id: 'inline', name: 'inline.png', type: 'image/png', size: 3, url: 'data:image/png;base64,AQID' } satisfies RuntimeMessageAttachment;
  const stored = { id: 'stored', source: 'runtime', name: 'stored.png', type: 'image/png', size: 3, assetId: 'stored-asset' } as const;
  const generated = { id: 'generated', source: 'generated', name: 'generated.png', type: 'image/png', size: 3, assetId: 'generated-asset', modelVisible: false } as const;
  const view = render(<ToastProvider><ChatMessageImageGallery attachments={[inline, stored, generated]} threadId="thread-1" variant="user" /></ToastProvider>);
  const storedImage = await view.findByRole('img', { name: stored.name });
  await view.findByRole('img', { name: generated.name });

  fireEvent.contextMenu(storedImage);
  fireEvent.click(await view.findByRole('menuitem', { name: '图片另存为…' }));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ attachment: { threadId: 'thread-1', assetId: 'stored-asset' }, name: stored.name }));
  await waitFor(() => expect(view.queryByRole('menu')).toBeNull());

  fireEvent.click(view.getByRole('button', { name: inline.name }));
  fireEvent.contextMenu(within(view.getByRole('dialog')).getByRole('img', { name: inline.name }));
  fireEvent.keyDown(await view.findByRole('menu'), { key: 'ArrowRight' });
  fireEvent.click(await view.findByRole('menuitem', { name: '复制图片' }));
  await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith({ dataUrl: inline.url, name: inline.name }));
  await waitFor(() => expect(view.queryByRole('menu')).toBeNull());

  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: '下一张图片' }));
  fireEvent.contextMenu(within(view.getByRole('dialog')).getByRole('img', { name: stored.name }));
  fireEvent.click(await view.findByRole('menuitem', { name: '图片另存为…' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith({ attachment: { threadId: 'thread-1', assetId: 'stored-asset' }, name: stored.name });
  await waitFor(() => expect(view.queryByRole('menu')).toBeNull());

  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: '下一张图片' }));
  fireEvent.contextMenu(within(view.getByRole('dialog')).getByRole('img', { name: generated.name }));
  fireEvent.click(await view.findByRole('menuitem', { name: '在文件夹中显示' }));
  await waitFor(() => expect(reveal).toHaveBeenCalledExactlyOnceWith({ assetId: 'generated-asset', name: generated.name }));
  await waitFor(() => expect(view.queryByRole('menu')).toBeNull());
  expect(view.getByRole('dialog')).toBeTruthy();
});
