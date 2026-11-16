// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HtmlFilePreview, type HtmlFilePreviewResource } from '../../src/html-file-preview/html-file-preview.js';

afterEach(cleanup);

it('releases a late preview after switching files and revokes the active resource on close', async () => {
  let finishOld!: (preview: HtmlFilePreviewResource) => void;
  const oldRequest = new Promise<HtmlFilePreviewResource>((resolve) => { finishOld = resolve; });
  const loadOld = vi.fn(() => oldRequest);
  const oldResource = { url: 'about:blank#old', dispose: vi.fn() };
  const currentResource = { url: 'about:blank#new', dispose: vi.fn() };
  const loadCurrent = vi.fn(async () => currentResource);
  const view = render(<HtmlFilePreview title="old.html" loadPreview={loadOld} />);
  expect(loadOld).toHaveBeenCalledOnce();
  view.rerender(<HtmlFilePreview title="new.html" loadPreview={loadCurrent} />);
  const frame = await screen.findByTitle('new.html');
  expect(frame.getAttribute('src')).toBe(currentResource.url);
  await act(async () => { finishOld(oldResource); await oldRequest; });
  expect(oldResource.dispose).toHaveBeenCalledOnce();
  expect(screen.getByTitle('new.html').getAttribute('src')).toBe(currentResource.url);
  expect(currentResource.dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(currentResource.dispose).toHaveBeenCalledOnce();
});
