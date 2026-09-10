// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopGitCommitDetails, DesktopReviewBridge } from '../../../src/contracts/index.js';
import { GitAuthorAvatar } from '../../../src/renderer/history/GitAuthorAvatar.js';
import { GitHistoryCommitCard } from '../../../src/renderer/history/GitHistoryCommitCard.js';
import { GitHistoryDiff } from '../../../src/renderer/history/GitHistoryDiff.js';
import { ReviewRendererTestHost } from '../review-renderer-test-host.js';

afterEach(cleanup);
const noop = () => undefined;
const githubUrl = `https://github.com/owner/repo/commit/${'a'.repeat(40)}`;
const image = 'https://avatars.githubusercontent.com/u/123?s=64';
const details: DesktopGitCommitDetails = {
  commit: { oid: 'a'.repeat(40), parents: [], subject: 'A commit', author: 'Alice', authoredAt: '2026-09-10T08:00:00Z' },
  githubUrl, message: 'A commit', baseOid: null, files: [],
};

it('loads the same author avatar in the hover card and detail without delaying local content', async () => {
  let finish!: (value: string) => void;
  const pending = new Promise<string>((resolve) => { finish = resolve; });
  const bridge = { getCommitAuthorAvatar: vi.fn().mockReturnValue(pending) } as unknown as DesktopReviewBridge;
  const view = render(<ReviewRendererTestHost bridge={bridge}>
    <GitHistoryCommitCard commit={details.commit} details={details} error={null} onRetry={noop} onCopyId={noop} />
    <GitHistoryDiff files={[]} details={details} pathContext={{ source: 'commit', workspaceRoot: '/repo', gitRoot: '/repo' }} selectionKey="commit" loading={false} error={null}
      actions={{ workspaceApp: null, workspaceApps: [], onAddFileToConversation: noop, onCopyFilePath: noop, onExternalOpenFile: noop, onOpenFileWithApp: noop, onOpenProjectFile: noop, onRevealFile: noop }}
      onRetry={noop} onBack={noop} />
  </ReviewRendererTestHost>);
  expect(view.container.textContent).toContain('A commit');
  expect(view.container.querySelector('.git-history-diff__author')?.textContent).toContain('Alice');
  expect(view.container.querySelectorAll('.git-author-avatar img')).toHaveLength(0);
  await act(async () => { finish(image); });
  expect([...view.container.querySelectorAll('.git-author-avatar img')].map((img) => img.getAttribute('src'))).toEqual([image, image]);
});

it('ignores stale author responses and retains the fallback for missing or broken images', async () => {
  const pending: Array<(value: string | null) => void> = [];
  const getCommitAuthorAvatar = vi.fn(() => new Promise<string | null>((resolve) => { pending.push(resolve); }));
  const bridge = { getCommitAuthorAvatar } as unknown as DesktopReviewBridge;
  const avatar = (author: string, url?: string) => <ReviewRendererTestHost bridge={bridge}><GitAuthorAvatar author={author} githubUrl={url} /></ReviewRendererTestHost>;
  const view = render(avatar('Alice', githubUrl));
  view.rerender(avatar('Bob', githubUrl.replace('/owner/', '/another/')));
  await act(async () => { pending[0](image); });
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.textContent).toBe('B');
  await act(async () => { pending[1](image); });
  const img = view.container.querySelector('img')!;
  fireEvent.error(img);
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.textContent).toBe('B');
  view.rerender(avatar('Charlie'));
  await waitFor(() => expect(view.container.textContent).toBe('C'));
  expect(getCommitAuthorAvatar).toHaveBeenCalledTimes(2);
});
