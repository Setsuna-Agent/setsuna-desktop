// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { DesktopWorkspaceFilePreviewResult, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceVideoPreview } from '../../../../../src/features/workspace/media/useWorkspaceVideoPreview.js';

const create = vi.fn();
const release = vi.fn(async () => true);
const originalBridge = window.setsunaDesktop;
const file: WorkspaceFileRead = {
  projectId: 'project', path: 'first.mp4', size: 1024, content: '', truncated: false,
  revision: 'first', preview: { kind: 'video', mimeType: 'video/mp4' },
};

beforeEach(() => {
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: {
    createWorkspaceFilePreview: create, releaseWorkspaceFilePreview: release,
  } } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: originalBridge });
});
function Host({ value = file }: { value?: WorkspaceFileRead }) {
  const { videoRef, error } = useWorkspaceVideoPreview(value, '/workspace');
  return <><video ref={videoRef} />{error ? <span role="alert">{error}</span> : null}</>;
}

it('releases a late URL after switching files and cancels the current stream on close', async () => {
  let resolve!: (value: DesktopWorkspaceFilePreviewResult) => void;
  create.mockReturnValueOnce(new Promise<DesktopWorkspaceFilePreviewResult>((done) => { resolve = done; }));
  create.mockResolvedValueOnce({ ok: true, url: 'http://localhost/second.mp4', previewId: 'second' });
  const view = render(<Host />);
  const video = view.container.querySelector('video')!;
  const pause = vi.spyOn(video, 'pause');
  const load = vi.spyOn(video, 'load');
  view.rerender(<Host value={{ ...file, path: 'second.mp4', revision: 'second' }} />);
  await waitFor(() => expect(video.src).toBe('http://localhost/second.mp4'));
  await act(async () => { resolve({ ok: true, url: 'http://localhost/first.mp4', previewId: 'first' }); });
  expect(release).toHaveBeenCalledWith('first');
  expect(video.src).toBe('http://localhost/second.mp4');
  pause.mockClear(); load.mockClear();
  view.unmount();
  expect(pause).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledOnce();
  expect(video.hasAttribute('src')).toBe(false);
  expect(release).toHaveBeenCalledWith('second');
});

it('renews the stream on a disk revision change and reports a failed native request', async () => {
  create.mockResolvedValueOnce({ ok: true, url: 'http://localhost/first.mp4', previewId: 'first' });
  create.mockResolvedValueOnce({ ok: false, error: 'File is unavailable.' });
  const view = render(<Host />);
  await waitFor(() => expect(view.container.querySelector('video')!.src).toBe('http://localhost/first.mp4'));
  view.rerender(<Host value={{ ...file, revision: 'changed' }} />);
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe('File is unavailable.'));
  expect(release).toHaveBeenCalledWith('first');
  expect(view.container.querySelector('video')!.hasAttribute('src')).toBe(false);
});
