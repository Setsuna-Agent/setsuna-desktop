// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownContentBlock } from '../../../../../src/features/chat/markdown/MarkdownContentBlock.js';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'setsunaDesktop');
});

it('copies the selected link address without navigating, including a different link after dismissal', async () => {
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const open = vi.fn();
  render(
    <MarkdownNavigationProvider onOpenWebLink={open}>
      <MarkdownContentBlock content="[**新闻**](https://example.com/story?id=42&source=chat) [文档](https://docs.example.org/guide#install)" />
    </MarkdownNavigationProvider>,
  );

  fireEvent.contextMenu(screen.getByText('新闻'), { clientX: 120, clientY: 80 });
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制链接' }));
  await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith('https://example.com/story?id=42&source=chat'));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

  fireEvent.contextMenu(screen.getByRole('link', { name: '文档' }), { clientX: 160, clientY: 80 });
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制链接' }));
  await waitFor(() => expect(copy).toHaveBeenLastCalledWith('https://docs.example.org/guide#install'));
  expect(copy).toHaveBeenCalledTimes(2);
  expect(open).not.toHaveBeenCalled();
});

it('routes explicit browser choices independently of normal clicks and cancels without opening', async () => {
  const openDefault = vi.fn();
  const openInApp = vi.fn();
  const openExternal = vi.fn(async () => true);
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: { links: { openExternal } },
  });
  const href = 'https://example.com/story';
  render(
    <MarkdownNavigationProvider onOpenWebLink={openDefault} onOpenInAppBrowser={openInApp}>
      <MarkdownContentBlock content={`[新闻](${href})`} />
    </MarkdownNavigationProvider>,
  );
  const link = screen.getByRole('link', { name: '新闻' });

  fireEvent.contextMenu(link);
  fireEvent.keyDown(await screen.findByRole('menuitem', { name: '复制链接' }), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(openDefault).not.toHaveBeenCalled();
  expect(openInApp).not.toHaveBeenCalled();
  expect(openExternal).not.toHaveBeenCalled();

  fireEvent.contextMenu(link);
  fireEvent.click(await screen.findByRole('menuitem', { name: '在内置浏览器打开' }));
  expect(openInApp).toHaveBeenCalledExactlyOnceWith(href);
  expect(openExternal).not.toHaveBeenCalled();
  expect(openDefault).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

  fireEvent.contextMenu(link);
  fireEvent.click(await screen.findByRole('menuitem', { name: '在外部浏览器打开' }));
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(href);
  expect(openInApp).toHaveBeenCalledOnce();
  expect(openDefault).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

  fireEvent.click(link);
  expect(openDefault).toHaveBeenCalledExactlyOnceWith(href);
  expect(openInApp).toHaveBeenCalledOnce();
  expect(openExternal).toHaveBeenCalledOnce();
});
