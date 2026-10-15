// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { RuntimeArtifact } from '../../src/contracts/index.js';
import { ArtifactToolResultView } from '../../src/renderer/ArtifactToolResultView.js';
import { ArtifactNavigationProvider } from '../../src/renderer/context.js';

afterEach(cleanup);
const artifact: RuntimeArtifact = {
  id: 'artifact', kind: 'file', name: 'report.md', path: 'docs/report.md',
  projectId: 'project', workspaceRoot: '/repo', mimeType: 'text/markdown', size: 128,
};

it.each([
  ['docs/report.md', 'text/markdown'],
  ['docs/REPORT.MD', 'application/octet-stream'],
  ['docs/report', 'text/markdown; charset=utf-8'],
])('reveals Markdown %s in Files without creating a browser preview, and keeps system opening', async (path, mimeType) => {
  const user = userEvent.setup();
  const onShowInFiles = vi.fn().mockResolvedValue(undefined);
  const onOpenBrowser = vi.fn();
  const host = { startFileDrag: null, createWorkspaceFilePreview: vi.fn(), openWorkspaceFile: vi.fn().mockResolvedValue({ ok: true }) };
  render(<ArtifactNavigationProvider projectId="project" onOpenBrowser={onOpenBrowser} onShowInFiles={onShowInFiles}>
    <ArtifactToolResultView host={host} payload={{ ...artifact, path, mimeType }} threadId="thread" translate={(key) => key} />
  </ArtifactNavigationProvider>);
  await user.click(screen.getByRole('button', { name: 'feature.artifact.openMode' }));
  expect(screen.queryByRole('menuitem', { name: 'feature.artifact.openInBrowser' })).toBeNull();
  await user.click(await screen.findByRole('menuitem', { name: 'feature.artifact.showInFiles' }));
  await waitFor(() => expect(onShowInFiles).toHaveBeenCalledExactlyOnceWith(path));
  expect(host.createWorkspaceFilePreview).not.toHaveBeenCalled();
  expect(onOpenBrowser).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'feature.artifact.openMode' }));
  await user.click(await screen.findByRole('menuitem', { name: 'feature.artifact.openDefault' }));
  await waitFor(() => expect(host.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith('/repo', path));
});

it('keeps browser previews for PDF and does not reveal an artifact in an unrelated project', async () => {
  const user = userEvent.setup();
  const onShowInFiles = vi.fn();
  const onOpenBrowser = vi.fn();
  const host = { startFileDrag: null, createWorkspaceFilePreview: vi.fn().mockResolvedValue({ ok: true, url: 'https://example.test/report.pdf' }), openWorkspaceFile: vi.fn() };
  render(<ArtifactNavigationProvider projectId="another-project" onOpenBrowser={onOpenBrowser} onShowInFiles={onShowInFiles}>
    <ArtifactToolResultView host={host} payload={{ ...artifact, path: 'report.pdf', mimeType: 'application/pdf' }} threadId="thread" translate={(key) => key} />
  </ArtifactNavigationProvider>);
  await user.click(screen.getByRole('button', { name: 'feature.artifact.openMode' }));
  expect(screen.queryByRole('menuitem', { name: 'feature.artifact.showInFiles' })).toBeNull();
  await user.click(await screen.findByRole('menuitem', { name: 'feature.artifact.openInBrowser' }));
  await waitFor(() => expect(onOpenBrowser).toHaveBeenCalledExactlyOnceWith('https://example.test/report.pdf'));
  expect(onShowInFiles).not.toHaveBeenCalled();
});

it('exports the artifact file through the native bridge and reports a missing file', async () => {
  const host = {
    createWorkspaceFilePreview: null, openWorkspaceFile: null,
    startFileDrag: vi.fn().mockResolvedValue({ ok: false, error: 'File no longer exists.' }),
  };
  render(<ArtifactToolResultView host={host} payload={artifact} threadId="thread" translate={(key, values) => String(values?.error ?? key)} />);
  expect(fireEvent.dragStart(screen.getByText(artifact.name))).toBe(false);
  expect(host.startFileDrag).toHaveBeenCalledExactlyOnceWith({
    kind: 'workspace-file', workspaceRoot: '/repo', filePath: 'docs/report.md',
  });
  expect((await screen.findByRole('alert')).textContent).toContain('File no longer exists.');
});
