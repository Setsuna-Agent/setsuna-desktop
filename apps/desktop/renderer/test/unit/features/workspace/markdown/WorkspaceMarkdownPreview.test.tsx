// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceMarkdownPreview } from '../../../../../src/features/workspace/markdown/WorkspaceMarkdownPreview.js';
import { resolveWorkspaceMarkdownTarget } from '../../../../../src/features/workspace/markdown/workspaceMarkdownLinks.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const file = { projectId: 'project', path: 'docs/README.md' };

it('renders README HTML, GFM and local images while removing executable content', async () => {
  const request = vi.fn().mockResolvedValue({ preview: { kind: 'image', mimeType: 'image/png', base64: 'aW1hZ2U=' } });
  vi.stubGlobal('setsunaDesktop', { runtime: { request } });
  const view = render(<WorkspaceMarkdownPreview file={file} content={[
    '<h1 align="center">Project</h1>',
    '<p align="center"><img src="../assets/logo.png" width="96" alt="Logo" onerror="alert(1)"></p>',
    '| Feature | Status |\n| --- | --- |\n| Preview | Ready |',
    '- [x] Complete\n- [ ] Pending',
    '<script>alert(1)</script><iframe src="https://example.com"></iframe>',
    '<a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a>',
    '<div style="position:fixed;inset:0" onmouseover="alert(1)">Safe text</div>',
  ].join('\n\n')} />);
  expect(screen.getByRole('heading', { name: 'Project' }).getAttribute('align')).toBe('center');
  expect(screen.getByRole('table').textContent).toContain('PreviewReady');
  expect(screen.getAllByRole('checkbox').map((node) => (node as HTMLInputElement).checked)).toEqual([true, false]);
  const image = await screen.findByRole('img', { name: 'Logo' });
  expect(image.getAttribute('src')).toBe('data:image/png;base64,aW1hZ2U=');
  expect(request).toHaveBeenCalledWith({ path: '/v1/projects/project/read?path=assets%2Flogo.png' });
  expect(view.container.querySelector('script, iframe, [onerror], [onclick], [onmouseover], [style]')).toBeNull();
  expect(screen.getByText('Unsafe link').closest('a')).toBeNull();
});

it('opens relative files in the workspace, external links through the bridge, and headings within the preview', () => {
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const onOpenFile = vi.fn();
  vi.stubGlobal('setsunaDesktop', { links: { openExternal } });
  const view = render(<WorkspaceMarkdownPreview file={file} onOpenFile={onOpenFile}
    content={'[Source](../src/app.ts#L12) [Web](https://example.com) [Jump](#section)\n\n## Section'} />);
  fireEvent.click(screen.getByRole('link', { name: 'Source' }));
  expect(onOpenFile).toHaveBeenCalledWith('src/app.ts', 12);
  fireEvent.click(screen.getByRole('link', { name: 'Web' }));
  expect(openExternal).toHaveBeenCalledWith('https://example.com');
  const heading = screen.getByRole('heading', { name: 'Section' });
  const scroll = vi.fn();
  heading.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole('link', { name: 'Jump' }));
  expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  expect(view.container.querySelector('h2')?.id).toBe('user-content-section');
});

it('ignores a pending image read when switching to another document', async () => {
  let resolveFirst!: (value: unknown) => void;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const request = vi.fn().mockReturnValueOnce(first)
    .mockResolvedValue({ preview: { kind: 'image', mimeType: 'image/png', base64: 'bmV3' } });
  vi.stubGlobal('setsunaDesktop', { runtime: { request } });
  const view = render(<WorkspaceMarkdownPreview file={file} content="![Logo](./logo.png)" />);
  view.rerender(<WorkspaceMarkdownPreview file={{ ...file, path: 'other/README.md' }} content="![Logo](./logo.png)" />);
  await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toContain('bmV3'));
  resolveFirst({ preview: { kind: 'image', mimeType: 'image/png', base64: 'b2xk' } });
  await first;
  expect(screen.getByRole('img').getAttribute('src')).toContain('bmV3');
});

it.each(['../../secret.txt', '%2e%2e/%2e%2e/secret.txt', 'file:///secret.txt', 'javascript:alert(1)', 'C:\\secret.txt', '%ZZ'])(
  'rejects paths outside the document workspace: %s', (url) => {
    expect(resolveWorkspaceMarkdownTarget(url, file.path)).toEqual({ kind: 'unavailable' });
  },
);
