// @vitest-environment happy-dom

import type { WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from '../../../../../src/features/chat/generative-ui/OpenUiRenderer.js';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(window, 'setsunaDesktop'); });

function imageProgram(source: string) {
  return `root = Stack([
    Image("plain", ${JSON.stringify(source)}),
    ImageBlock(${JSON.stringify(source)}, "block"),
    ImageGallery([{ src: ${JSON.stringify(source)}, alt: "gallery" }]),
    ImageText(${JSON.stringify(source)}, "thumbnail", "title"),
    ImageTextLarge(${JSON.stringify(source)}, "banner", "title"),
    ListBlock([ListItem("item", null, {src: ${JSON.stringify(source)}, alt: "list"})], "image"),
    ContextCardBlock([ContextCardItem("a", "first", null, null, ${JSON.stringify(source)}), ContextCardItem("b", "second")]),
    VisualCardBlock([VisualCardItem(BoldText("text", "first"), "a", ${JSON.stringify(source)}), VisualCardItem(BoldText("text", "second"), "b")])
  ])`;
}

function listing(root: string): WorkspaceEntrySearchResponse {
  return { workspaceRoot: root, query: '', scanned: 2, truncated: false, entries: ['image.png', 'denied.png']
    .map((name) => ({ name, path: name, parent: '', kind: 'file' })) };
}

describe('OpenUI workspace images', () => {
  it.each(['file:///private/image.png', '/private/image.png', '../image.png', '%2e%2e/image.png',
    'file:///C:/private/image.png', 'file:\t///private/image.png', 'data:image/png;base64,AAAA', 'blob:https://example.com/id'])(
    'never passes an unsafe source to an image or a CSS background: %s', (source) => {
      const preview = vi.fn();
      Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: { createWorkspaceFilePreview: preview, releaseWorkspaceFilePreview: vi.fn(async () => true) } } });
      const view = render(<MarkdownNavigationProvider workspaceRoot="/workspace">
        <OpenUiRenderer code={imageProgram(source)} streaming={false} />
      </MarkdownNavigationProvider>);
      expect(view.getByRole('img', { name: 'plain' })).toBeTruthy();
      for (const image of view.container.querySelectorAll('img')) expect(image.getAttribute('src') || '').toBe('');
      for (const node of view.container.querySelectorAll('[style]')) expect(node.getAttribute('style')).not.toContain(source);
      expect(preview).not.toHaveBeenCalled();
    },
  );

  it('resolves every image variant through the preview bridge and honors rejected previews', async () => {
    const preview = vi.fn(async (_root: string, file: string) => file === 'denied.png'
      ? { ok: false, error: 'File path must stay inside the workspace.' }
      : { ok: true, previewId: 'image-preview', url: 'http://127.0.0.1:1234/preview/image.png' });
    Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: { createWorkspaceFilePreview: preview, releaseWorkspaceFilePreview: vi.fn(async () => true) } } });
    const search = vi.fn(async () => listing('/workspace'));
    const display = (source: string) => <MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={search}>
      <OpenUiRenderer code={imageProgram(source)} streaming={false} />
    </MarkdownNavigationProvider>;
    const view = render(display('file:///workspace/image.png'));
    await waitFor(() => expect(view.getAllByRole('img')).toHaveLength(6));
    await waitFor(() => {
      for (const image of view.getAllByRole('img')) expect(image.getAttribute('src')).toBe('http://127.0.0.1:1234/preview/image.png');
    });
    expect(preview.mock.calls.every(([root, file]) => root === '/workspace' && file === 'image.png')).toBe(true);
    view.rerender(display('denied.png'));
    await waitFor(() => expect(preview).toHaveBeenCalledWith('/workspace', 'denied.png'));
    for (const image of view.container.querySelectorAll('img')) expect(image.getAttribute('src') || '').toBe('');
  });

  it('discards pending local previews after a workspace or source change, while allowing HTTPS images', async () => {
    let finish!: (value: { ok: true; previewId: string; url: string }) => void;
    const preview = vi.fn(() => new Promise<{ ok: true; previewId: string; url: string }>((resolve) => { finish = resolve; }));
    Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: { createWorkspaceFilePreview: preview, releaseWorkspaceFilePreview: vi.fn(async () => true) } } });
    const search = vi.fn(async () => listing('/workspace'));
    const view = render(<MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={search}>
      <OpenUiRenderer code='root = Stack([Image("photo", "image.png")])' streaming={false} />
    </MarkdownNavigationProvider>);
    await waitFor(() => expect(preview).toHaveBeenCalledOnce());
    view.rerender(<MarkdownNavigationProvider workspaceRoot="/other">
      <OpenUiRenderer code='root = Stack([Image("photo", "https://example.com/photo.png")])' streaming={false} />
    </MarkdownNavigationProvider>);
    await act(async () => finish({ ok: true, previewId: 'image-preview', url: 'http://127.0.0.1:1234/preview/stale' }));
    expect(view.getByRole('img', { name: 'photo' }).getAttribute('src')).toBe('https://example.com/photo.png');
  });

  it('checks evaluated sources again after a local state action', async () => {
    const view = render(<OpenUiRenderer streaming={false} code={[
      'root = Stack([Image("photo", $source), Button("switch", @Set($source, "file:///private/image.png"))])',
      '$source = "https://example.com/photo.png"',
    ].join('\n')} />);
    expect(view.getByRole('img', { name: 'photo' }).getAttribute('src')).toBe('https://example.com/photo.png');
    fireEvent.click(view.getByRole('button', { name: 'switch' }));
    await waitFor(() => expect(view.getByRole('img', { name: 'photo' }).getAttribute('src') || '').toBe(''));
  });
});
