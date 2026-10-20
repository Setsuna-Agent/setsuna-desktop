// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PullRequestDiscussion, ThreadPullRequest, ThreadPullRequestsStateService } from '../../../src/contracts/index.js';
import type { PullRequestsClient } from '../../../src/renderer/client.js';
import { PullRequestDetailPane } from '../../../src/renderer/PullRequestDetailPane.js';
import { createPullRequestSession, getPullRequestDetailSession } from '../../../src/renderer/session.js';
import { PullRequestWorkspacePanel } from '../../../src/renderer/threads/PullRequestWorkspacePanel.js';
import { PullRequestConnectionState } from '../../../src/renderer/account/connection-state.js';
import { readRequest } from '../../../src/runtime/pull-requests.js';
import { commentNode, githubFixture, reference, repositoryNode } from '../../support/github-fixture.js';
import { RendererHost, rendererHost } from '../../support/renderer-host.js';

afterEach(cleanup);

it('loads Diff on demand and restores file preferences after closing the dialog or switching PRs', async () => {
  const pr = await readRequest(githubFixture(() => ({ repository: repositoryNode() })).api, reference);
  const paths = ['src/a.ts', 'src/b.ts', 'docs/readme.md'];
  const client = {
    connection: vi.fn(async () => ({ state: 'connected', login: 'alice', avatarUrl: null, error: null, loginCommand: '' })),
    detail: vi.fn(async ({ number }: { number: number }) => ({ ...pr, number })),
    discussions: vi.fn(async () => ({ items: [], cursor: null })),
    activity: vi.fn(async () => ({ items: [], cursor: null })),
    checks: vi.fn(async () => ({ items: [], cursor: null })),
    files: vi.fn(async () => ({ files: paths.map((path) => ({ path, previousPath: null, status: 'modified', additions: 1, deletions: 1 })), nextPage: null, total: paths.length, reset: false })),
    patch: vi.fn(async ({ path, number }: { path: string; number: number }) => ({ kind: 'text', patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+PR ${number} ${path}\n` })),
  } as unknown as PullRequestsClient;
  const connectionState = new PullRequestConnectionState(client);
  const items: readonly ThreadPullRequest[] = [];
  const state: ThreadPullRequestsStateService = { getSnapshot: () => items, subscribe: () => () => undefined, refresh: vi.fn() };
  const session = createPullRequestSession();
  const panel = (number: number) => <PullRequestWorkspacePanel key={number} client={client} connectionState={connectionState}
    host={rendererHost} reference={{ ...reference, number }} threadId="thread" state={state} session={session} />;
  const openDiff = async () => {
    await waitFor(() => expect((screen.getByRole('button', { name: 'viewDiff' }) as HTMLButtonElement).disabled).toBe(false));
    const trigger = screen.getByRole('button', { name: 'viewDiff' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'diff' });
    return trigger;
  };
  const view = render(panel(12));
  await screen.findByRole('textbox', { name: 'comment' });
  expect(client.files).not.toHaveBeenCalled();
  expect(client.patch).not.toHaveBeenCalled();
  const editor = screen.getByRole('textbox', { name: 'comment' }) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: 'Review draft' } });
  const trigger = await openDiff();
  fireEvent.click(await screen.findByRole('button', { name: 'b.ts', exact: true }));
  await screen.findByText(/PR 12 src\/b.ts/);
  fireEvent.click(screen.getByRole('button', { name: 'unified', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'wrapOn', exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name: 'searchFiles' }), { target: { value: 'src/' } });
  fireEvent.click(screen.getByRole('button', { name: 'src', exact: true }));

  fireEvent.click(within(screen.getByRole('dialog', { name: 'diff' })).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(editor.value).toBe('Review draft');
  await openDiff();
  await screen.findByText(/PR 12 src\/b.ts/);
  expect(screen.getByRole('button', { name: 'split', exact: true })).toBeTruthy();

  view.rerender(panel(13));
  await screen.findByRole('textbox', { name: 'comment' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await openDiff();
  await screen.findByText(/PR 13 src\/a.ts/);
  expect(screen.getByRole('button', { name: 'unified', exact: true })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'src', exact: true }).getAttribute('aria-expanded')).toBe('true');

  view.rerender(panel(12));
  await openDiff();
  await screen.findByText(/PR 12 src\/b.ts/);
  expect((screen.getByRole('textbox', { name: 'searchFiles' }) as HTMLInputElement).value).toBe('src/');
  expect(screen.getByRole('button', { name: 'src', exact: true }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: 'split', exact: true })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'wrapOff', exact: true })).toBeTruthy();
  view.unmount();
  connectionState.dispose();
});

it('opens the discussion file, cancels its pending read on Escape and restores focus after opening from metadata', async () => {
  const pr = await readRequest(githubFixture(() => ({ repository: repositoryNode() })).api, reference);
  const discussion: PullRequestDiscussion = {
    id: 'thread', kind: 'thread', state: null, resolved: false, outdated: false, canReply: true,
    path: 'src/b.ts', line: 1, side: 'RIGHT', diffHunk: null, commitSha: null,
    comments: [commentNode('C1')], replyCursor: null,
  };
  const patch = vi.fn<PullRequestsClient['patch']>().mockImplementation(() => new Promise(() => undefined));
  const client = {
    detail: vi.fn(async () => pr),
    discussions: vi.fn(async ({ kind }: Parameters<PullRequestsClient['discussions']>[0]) => ({ items: kind === 'threads' ? [discussion] : [], cursor: null })),
    activity: vi.fn(async () => ({ items: [], cursor: null })), checks: vi.fn(async () => ({ items: [], cursor: null })),
    files: vi.fn(async () => ({ files: ['src/a.ts', 'src/b.ts'].map((path) => ({
      path, previousPath: null, status: 'modified', additions: 1, deletions: 1,
    })), nextPage: null, total: 2, reset: false })),
    patch,
  } as unknown as PullRequestsClient;
  const session = getPullRequestDetailSession(createPullRequestSession(), 'alice', reference);
  render(<PullRequestDetailPane client={client} reference={reference} account="alice" session={session} onUpdated={vi.fn()} />, { wrapper: RendererHost });
  const trigger = await within(await screen.findByRole('region', { name: 'activity' })).findByRole('button', { name: 'viewDiff' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'diff' });
  await waitFor(() => expect(patch).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/b.ts' }), expect.any(AbortSignal)));
  const signal = patch.mock.calls.at(-1)![1]!;
  expect(signal.aborted).toBe(false);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(trigger));

  const info = screen.getByRole('button', { name: 'statusPanel' });
  fireEvent.click(info);
  fireEvent.click(await screen.findByRole('button', { name: /changedFiles/ }));
  await screen.findByRole('dialog', { name: 'diff' });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(info));
});

it('isolates reading sessions by account, conversation and PR while normalizing GitHub identity', () => {
  const session = createPullRequestSession();
  const original = getPullRequestDetailSession(session, 'Alice', reference, 'first-thread');
  original.diff.activePath = 'src/b.ts';
  original.scroll.set('detail', { top: 600, left: 0 });
  expect(getPullRequestDetailSession(session, 'alice', { ...reference, repository: 'OWNER/REPO' }, 'first-thread')).toBe(original);
  for (const other of [
    getPullRequestDetailSession(session, 'bob', reference, 'first-thread'),
    getPullRequestDetailSession(session, 'alice', reference, 'second-thread'),
    getPullRequestDetailSession(session, 'alice', { ...reference, number: 13 }, 'first-thread'),
    getPullRequestDetailSession(session, 'alice', reference),
  ]) {
    expect(other.diff.activePath).toBeNull();
    expect(other.scroll.size).toBe(0);
  }
});
