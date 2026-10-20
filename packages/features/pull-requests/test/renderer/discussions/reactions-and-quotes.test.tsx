// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PullRequestDiscussion, PullRequestReaction } from '../../../src/contracts/index.js';
import type { PullRequestsClient } from '../../../src/renderer/client.js';
import { PullRequestsHostContext } from '../../../src/renderer/context.js';
import { DiscussionCard, DiscussionTimeline } from '../../../src/renderer/DiscussionTimeline.js';
import { usePullRequestReaction } from '../../../src/renderer/discussions/usePullRequestReaction.js';
import { readDraft } from '../../../src/renderer/useCommentDraft.js';
import { readRequest } from '../../../src/runtime/pull-requests.js';
import { commentNode, githubFixture, reference, repositoryNode } from '../../support/github-fixture.js';
import { RendererHost, rendererHost } from '../../support/renderer-host.js';

afterEach(cleanup);
const detail = () => readRequest(githubFixture(() => ({ repository: repositoryNode() })).api, reference);
const discussion = (kind: PullRequestDiscussion['kind']): PullRequestDiscussion => ({
  id: 'D1', kind, state: null, resolved: false, outdated: false, canReply: true,
  path: 'a.ts', line: 1, side: 'RIGHT', diffHunk: null, commitSha: null,
  comments: [commentNode('C1', 'First line\nSecond line')], replyCursor: null,
});

it('prevents duplicate reactions, uses the confirmed state for removal and preserves counts on failure', async () => {
  const initial: PullRequestReaction[] = [{ content: 'HEART', count: 2, viewerHasReacted: false }];
  let resolve!: (value: { reactions: PullRequestReaction[] }) => void;
  const react = vi.fn<PullRequestsClient['react']>().mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const notifyError = vi.fn();
  const onUpdated = vi.fn();
  const client = { react } as unknown as PullRequestsClient;
  const hook = renderHook(() => usePullRequestReaction({ client, reference, subjectId: 'C1', account: 'alice', reactions: initial, onUpdated }),
    { wrapper: ({ children }) => <PullRequestsHostContext.Provider value={{ ...rendererHost, notifyError }}>{children}</PullRequestsHostContext.Provider> });
  act(() => { void hook.result.current.toggle('HEART'); void hook.result.current.toggle('HEART'); });
  expect(react).toHaveBeenCalledExactlyOnceWith({ ...reference, subjectId: 'C1', expectedAccount: 'alice', content: 'HEART', action: 'add' });
  expect(hook.result.current.items).toEqual(initial);
  await act(async () => resolve({ reactions: [{ content: 'HEART', count: 3, viewerHasReacted: true }] }));
  expect(onUpdated).toHaveBeenCalledOnce();
  react.mockRejectedValueOnce(new Error('Disconnected'));
  await act(() => hook.result.current.toggle('HEART'));
  expect(react.mock.calls.at(-1)![0].action).toBe('remove');
  expect(notifyError).toHaveBeenCalledOnce();
  expect(hook.result.current.items).toEqual([{ content: 'HEART', count: 3, viewerHasReacted: true }]);
  expect(hook.result.current.pending).toBe(false);
});

it('keeps quote references with the existing draft and only publishes after submit', async () => {
  const pr = await detail();
  const account = `quote-${crypto.randomUUID()}`;
  const publish = vi.fn().mockResolvedValue(commentNode('PUBLISHED'));
  const client = { publish, activity: vi.fn(async () => ({ items: [], cursor: null })) } as unknown as PullRequestsClient;
  const item = discussion('comment');
  item.comments[0].body = 'Quoted passage';
  render(<DiscussionTimeline client={client} detail={pr} account={account} revision={0} onPublished={vi.fn()} onDiff={vi.fn()}
    discussions={{ items: [item], pending: false, errors: [], hasMore: false, more: vi.fn(), moreReplies: vi.fn(), repliesPending: null }} />, { wrapper: RendererHost });
  const editor = screen.getByRole('textbox', { name: 'comment' }) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: 'My existing draft' } });
  const comment = within(screen.getByRole('region', { name: 'activity' })).getByRole('region', { name: 'comment' });
  fireEvent.click(within(comment).getByRole('button', { name: 'quoteReply' }));
  await waitFor(() => expect(editor.value).toBe('My existing draft\n\n@alice\n> Quoted passage\n\n'));
  const key = `${account}/${reference.repository}/${reference.number}/conversation`;
  expect(readDraft(key).quotes).toEqual([expect.objectContaining({
    author: 'alice', text: 'Quoted passage', start: 'My existing draft\n\n'.length,
  })]);
  expect(publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'publishComment' }));
  await waitFor(() => expect(readDraft(key)).toMatchObject({ body: '', quotes: [], uncertain: false }));
  expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    body: 'My existing draft\n\n@alice\n> Quoted passage\n\n', reconcileOnly: false,
  }));
});

it('quotes a selected passage into its review thread while leaving the PR draft untouched', async () => {
  const pr = await detail();
  const account = `quote-${crypto.randomUUID()}`;
  const publish = vi.fn();
  render(<DiscussionCard discussion={discussion('thread')} client={{ publish } as unknown as PullRequestsClient} detail={pr} account={account}
    onPublished={vi.fn()} onDiff={vi.fn()} />, { wrapper: RendererHost });
  const text = screen.getByText('First line Second line').firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 'First line'.length);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.click(screen.getByRole('button', { name: 'quoteReply' }));
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'reply' }) as HTMLTextAreaElement).value).toBe('@alice\n> First line\n\n'));
  expect(readDraft(`${account}/${reference.repository}/${reference.number}/D1`).quotes).toEqual([
    expect.objectContaining({ author: 'alice', text: 'First line', start: 0 }),
  ]);
  expect(readDraft(`${account}/${reference.repository}/${reference.number}/conversation`).body).toBe('');
  expect(publish).not.toHaveBeenCalled();
});
