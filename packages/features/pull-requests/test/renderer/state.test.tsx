// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { PullRequestDetail, PullRequestDiscussion, PullRequestListResult } from '../../src/contracts/index.js';
import type { PullRequestsClient } from '../../src/renderer/client.js';
import type { PullRequestsRendererHost } from '../../src/renderer/host.js';
import { PullRequestsHostContext } from '../../src/renderer/context.js';
import { usePullRequestList } from '../../src/renderer/usePullRequestList.js';
import { usePullRequestFiles } from '../../src/renderer/usePullRequestFiles.js';
import { useDiscussions } from '../../src/renderer/useDiscussions.js';
import { useCliInstallation } from '../../src/renderer/useCliInstallation.js';
import { useConnection } from '../../src/renderer/useConnection.js';
import { CommentComposer } from '../../src/renderer/CommentComposer.js';
import { MergeActions } from '../../src/renderer/MergeActions.js';
import { PullRequestsPage } from '../../src/renderer/PullRequestsPage.js';
import { createPullRequestSession } from '../../src/renderer/session.js';
import { readDraft, saveDraft } from '../../src/renderer/useCommentDraft.js';
import { readRequest, summary } from '../../src/runtime/pull-requests.js';
import { commentNode, githubFixture, head, reference, repositoryNode, summaryNode } from '../support/github-fixture.js';

afterEach(() => { cleanup(); notifyError.mockClear(); });
const notifyError = vi.fn();
const host: PullRequestsRendererHost = {
  Markdown: ({ content }) => <div>{content}</div>, PageHeader: () => null, CodePatch: () => null,
  CommentInput: ({ value, label, disabled, maxLength, onChange, footer }) => <><textarea aria-label={label} value={value} disabled={disabled} maxLength={maxLength} onChange={(event) => onChange(event.currentTarget.value)} />{footer}</>,
  translate: (key, params) => `${key.replace('feature.pullRequests.', '')}${params?.error ? `: ${params.error}` : ''}`,
  locale: 'en', openExternal: vi.fn(), copyText: vi.fn(), notifyError,
};
const wrapper = ({ children }: { children: ReactNode }) => <PullRequestsHostContext.Provider value={host}>{children}</PullRequestsHostContext.Provider>;
const clientWith = (methods: Partial<PullRequestsClient>) => methods as PullRequestsClient;
const detail = () => readRequest(githubFixture(() => ({ repository: repositoryNode() })).api, reference);

describe('PR navigation and drafts', () => {
  it.each([true, false])('prefers current paths when selecting diffs, with old paths as a fallback (reused: %s)', async (reused) => {
    const pr = await detail();
    const renamed = { path: 'a.ts', previousPath: 'z.ts', status: 'renamed', additions: 1, deletions: 1 };
    const files = [renamed, ...(reused ? [{ ...renamed, path: 'z.ts', previousPath: null, status: 'added' }] : [])];
    const patchFor = (path: string) => ({ kind: 'text' as const, patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+${path}\n` });
    const patch = vi.fn(async ({ path }: { path: string }) => patchFor(path));
    const client = clientWith({
      files: vi.fn(async () => ({ files, total: files.length, nextPage: null, reset: false })), patch,
    });
    const hook = renderHook(({ path }) => usePullRequestFiles(client, pr, path), { initialProps: { path: 'a.ts' } });
    await waitFor(() => expect(hook.result.current.patch).toEqual(patchFor('a.ts')));
    hook.rerender({ path: 'z.ts' });
    const selectedPath = reused ? 'z.ts' : 'a.ts';
    await waitFor(() => expect(hook.result.current.patch).toEqual(patchFor(selectedPath)));
    expect(hook.result.current.path).toBe(selectedPath);
    expect(patch).toHaveBeenLastCalledWith({ ...reference, baseSha: pr.baseSha, headSha: pr.headSha, path: selectedPath }, expect.anything());
  });

  it('resumes an installation already running in the runtime and refreshes the account when it completes', async () => {
    const refresh = vi.fn(async () => undefined);
    const installation = vi.fn()
      .mockResolvedValueOnce({ phase: 'downloading', receivedBytes: 3, totalBytes: 10, error: null })
      .mockResolvedValueOnce({ phase: 'complete', receivedBytes: 10, totalBytes: 10, error: null });
    const install = vi.fn();
    const client = clientWith({ installation, install });
    const hook = renderHook(() => useCliInstallation(client, refresh), { wrapper });
    await waitFor(() => expect(hook.result.current.pending).toBe(true));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce(), { timeout: 2000 });
    expect(hook.result.current.pending).toBe(false);
    expect(install).not.toHaveBeenCalled();
  });

  it('allows rechecking the same installation after a progress request fails', async () => {
    const refresh = vi.fn(async () => undefined);
    const installation = vi.fn()
      .mockResolvedValueOnce({ phase: 'downloading', receivedBytes: 3, totalBytes: 10, error: null })
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({ phase: 'complete', receivedBytes: 10, totalBytes: 10, error: null });
    const install = vi.fn(async () => ({ phase: 'installing' as const, receivedBytes: 10, totalBytes: 10, error: null }));
    const client = clientWith({ installation, install });
    const hook = renderHook(() => useCliInstallation(client, refresh), { wrapper });
    await waitFor(() => expect(hook.result.current.state?.phase).toBe('error'), { timeout: 2000 });
    expect(hook.result.current.pending).toBe(false);
    expect(notifyError).toHaveBeenCalledWith('installFailed: Connection lost');
    await act(() => hook.result.current.start());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(install).toHaveBeenCalledOnce();
  });
  it('requests all states by default, combines menu filters and clears them without losing the search', async () => {
    const user = userEvent.setup();
    const repositories = ['owner/repo', 'owner/other'].map((id) => ({ id, fullName: id, projects: [], remotes: [] }));
    const list = vi.fn(async () => ({ items: [], cursor: null }));
    const client = clientWith({
      connection: vi.fn(async () => ({ state: 'connected', login: 'alice', avatarUrl: null, error: null, loginCommand: 'gh auth login --hostname github.com --web' })),
      installation: vi.fn(async () => ({ phase: 'idle', receivedBytes: 0, totalBytes: null, error: null })),
      repositories: vi.fn(async () => ({ repositories, issues: [] })), list,
    });
    const session = createPullRequestSession();
    render(<PullRequestsPage client={client} host={host} session={session} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    for (const repo of repositories) expect(list).toHaveBeenCalledWith({ repository: repo.id, cursor: null, filters: { state: 'all', author: '', search: '' } }, expect.anything());

    const chooseFilter = async (category: string, choice: string) => {
      await user.click(screen.getByRole('button', { name: 'filters' }));
      const submenu = await screen.findByRole('menuitem', { name: category, exact: true });
      act(() => submenu.focus());
      await user.keyboard('{ArrowRight}');
      await user.click(await screen.findByRole('menuitem', { name: choice, exact: true }));
    };
    fireEvent.change(screen.getByRole('textbox', { name: 'search' }), { target: { value: '#164' } });
    await chooseFilter('status', 'merged');
    await chooseFilter('repository', 'owner/other');
    await chooseFilter('author', 'customAuthor');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'author' }), { target: { value: ' @someone-else ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'applyFilter' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ repository: 'owner/other', cursor: null, filters: { state: 'merged', author: 'someone-else', search: '#164' } }, expect.anything()));
    expect(session).toMatchObject({ repository: 'owner/other', filters: { state: 'merged', author: 'someone-else', search: '#164' } });

    list.mockClear();
    await user.click(screen.getByRole('button', { name: 'filters' }));
    await user.click(await screen.findByRole('menuitem', { name: 'clearFilters' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    for (const repo of repositories) expect(list).toHaveBeenCalledWith({ repository: repo.id, cursor: null, filters: { state: 'all', author: '', search: '#164' } }, expect.anything());
  });

  it('retains loaded pages on refresh, reports per-repository errors, and ignores results from previous filters', async () => {
    let resolveOld!: (value: PullRequestListResult) => void;
    const list = vi.fn(async ({ repository, cursor, filters }) => {
      if (repository === 'owner/private') throw new Error('Permission denied');
      if (filters.search === 'old') return new Promise<PullRequestListResult>((resolve) => { resolveOld = resolve; });
      if (filters.search === 'new') return { items: [summary(summaryNode(3), repository)], cursor: null };
      return { items: [summary(summaryNode(cursor ? 2 : 1), repository)], cursor: cursor ? null : 'page2' };
    });
    const client = clientWith({ list, repositories: vi.fn(async () => ({ repositories: ['owner/repo', 'owner/private'].map((id) => ({ id, fullName: id, projects: [], remotes: [] })), issues: [] })) });
    const hook = renderHook(({ search }) => usePullRequestList(client, 'alice', '', { state: 'open', author: '', search }), { initialProps: { search: '' } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.items.map((item) => item.number)).toEqual([1]);
    expect(hook.result.current.errors).toEqual([{ repository: 'owner/private', message: 'Permission denied' }]);
    await act(() => hook.result.current.more());
    expect(hook.result.current.items.map((item) => item.number)).toEqual([1, 2]);
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.items.map((item) => item.number)).toEqual([1, 2]);
    hook.rerender({ search: 'old' });
    expect(hook.result.current.items).toEqual([]);
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    hook.rerender({ search: 'new' });
    await waitFor(() => expect(hook.result.current.items.map((item) => item.number)).toEqual([3]));
    await act(async () => resolveOld({ items: [summary(summaryNode(99), reference.repository)], cursor: null }));
    expect(hook.result.current.items.map((item) => item.number)).toEqual([3]);
  });

  it('retains loaded discussion pages and nested replies after the PR refreshes', async () => {
    const pr = await detail();
    const thread = (id: string): PullRequestDiscussion => ({ id, kind: 'thread', state: null, resolved: false, outdated: false, canReply: true, path: 'a.ts', line: 1, side: 'RIGHT', diffHunk: null, commitSha: head, comments: [commentNode(`${id}_1`)], replyCursor: 'reply2' });
    const client = clientWith({
      discussions: vi.fn(async ({ kind, cursor }) => kind === 'threads' ? { items: [thread(cursor ? 'T2' : 'T1')], cursor: cursor ? null : 'threads2' } : { items: [], cursor: null }),
      replies: vi.fn(async ({ threadId }) => ({ comments: [commentNode(`${threadId}_2`)], cursor: null })),
    });
    const hook = renderHook(({ revision }) => useDiscussions(client, pr, revision), { initialProps: { revision: 0 } });
    await waitFor(() => expect(hook.result.current.pending).toBe(false));
    await act(() => hook.result.current.more());
    await act(() => hook.result.current.moreReplies(hook.result.current.items[0]));
    hook.rerender({ revision: 1 });
    await waitFor(() => expect(hook.result.current.pending).toBe(false));
    expect(hook.result.current.items.map((item) => item.id)).toEqual(['T1', 'T2']);
    expect(hook.result.current.items[0].comments.map((item) => item.id)).toEqual(['T1_1', 'T1_2']);
  });

  it('shares edits, publication locking and clearing between both reply editors without affecting another thread', async () => {
    const user = userEvent.setup();
    const account = `alice-${crypto.randomUUID()}`;
    let complete!: (value: ReturnType<typeof commentNode>) => void;
    const publish = vi.fn(() => new Promise<ReturnType<typeof commentNode>>((resolve) => { complete = resolve; }));
    const client = clientWith({ publish });
    const onPublished = vi.fn();
    render(<>
      <CommentComposer client={client} reference={reference} account={account} threadId="T1" onPublished={onPublished} />
      <CommentComposer client={client} reference={reference} account={account} threadId="T1" onPublished={onPublished} />
      <CommentComposer client={client} reference={reference} account={account} threadId="T2" onPublished={onPublished} />
    </>, { wrapper });
    const [overview, diff, other] = screen.getAllByRole('textbox', { name: 'reply' }) as HTMLTextAreaElement[];
    await user.type(overview, 'Shared reply');
    expect(diff.value).toBe('Shared reply');
    await user.type(diff, ' with more context');
    expect(overview.value).toBe('Shared reply with more context');
    await user.type(other, 'Another thread');
    const key = `${account}/${reference.repository}/${reference.number}/T1`;
    const requestId = readDraft(key).requestId;
    await user.click(screen.getAllByRole('button', { name: 'reply', exact: true })[0]);
    expect(overview.disabled).toBe(true);
    expect(diff.disabled).toBe(true);
    expect(other.disabled).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'reply', exact: true })[1]);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({ ...reference, expectedAccount: account, threadId: 'T1', body: 'Shared reply with more context', requestId, reconcileOnly: false });
    await act(async () => complete(commentNode('C1')));
    expect(overview.value).toBe('');
    expect(diff.value).toBe('');
    expect(overview.disabled).toBe(false);
    expect(diff.disabled).toBe(false);
    expect(other.value).toBe('Another thread');
    expect(onPublished).toHaveBeenCalledOnce();
  });

  it('keeps a possibly sent draft across navigation and only reconciles it when the composer is reopened', async () => {
    const account = `alice-${crypto.randomUUID()}`;
    const key = `${account}/${reference.repository}/${reference.number}/conversation`;
    let rejectSend!: (reason: Error) => void;
    const publish = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectSend = reject; })).mockRejectedValueOnce(new Error('Lookup unavailable')).mockResolvedValue(commentNode('C1'));
    const onPublished = vi.fn();
    const client = clientWith({ publish });
    const first = render(<CommentComposer client={client} reference={reference} account={account} onPublished={onPublished} />, { wrapper });
    fireEvent.change(screen.getByRole('textbox', { name: 'comment' }), { target: { value: 'Draft body' } });
    fireEvent.click(screen.getByRole('button', { name: 'publishComment' }));
    expect(readDraft(key)).toMatchObject({ body: 'Draft body', uncertain: true });
    first.unmount();
    await act(async () => rejectSend(new Error('Lost response')));
    expect(onPublished).not.toHaveBeenCalled();
    render(<CommentComposer client={client} reference={reference} account={account} onPublished={onPublished} />, { wrapper });
    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(publish.mock.calls.map(([input]) => input.reconcileOnly)).toEqual([false, true, true]);
    expect(publish.mock.calls[0][0].requestId).toBe(publish.mock.calls[1][0].requestId);
    expect(readDraft(key).body).toBe('');
  });

  it.each(['GitHub rejected this comment', 'The organization has enabled OAuth App access restrictions'])('retains a rejected draft for editing without looking for a comment that was never sent (%s)', async (message) => {
    const account = `alice-${crypto.randomUUID()}`;
    const key = `${account}/${reference.repository}/${reference.number}/conversation`;
    const publish = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error(message), { code: 'PR_COMMENT_NOT_SENT' }))
      .mockResolvedValueOnce(commentNode('C1'));
    const onPublished = vi.fn();
    render(<CommentComposer client={clientWith({ publish })} reference={reference} account={account} onPublished={onPublished} />, { wrapper });
    fireEvent.change(screen.getByRole('textbox', { name: 'comment' }), { target: { value: 'Draft body' } });
    fireEvent.click(screen.getByRole('button', { name: 'publishComment' }));
    await waitFor(() => expect(readDraft(key).uncertain).toBe(false));
    expect(notifyError).toHaveBeenCalledWith(message.includes('OAuth') ? 'organizationApprovalRequired' : `commentFailed: ${message}`);
    expect((screen.getByRole('textbox', { name: 'comment' }) as HTMLTextAreaElement).disabled).toBe(false);
    expect(readDraft(key).body).toBe('Draft body');
    fireEvent.click(screen.getByRole('button', { name: 'publishComment' }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(publish.mock.calls.map(([input]) => input.reconcileOnly)).toEqual([false, false]);
    expect(publish.mock.calls[1][0].requestId).toBe(publish.mock.calls[0][0].requestId);
    expect(readDraft(key).body).toBe('');
  });

  it('keeps the original send for reconciliation while allowing edits after a failed lookup', async () => {
    const account = `alice-${crypto.randomUUID()}`;
    const key = `${account}/${reference.repository}/${reference.number}/conversation`;
    const draft = { body: 'Possibly sent', requestId: crypto.randomUUID(), uncertain: true };
    saveDraft(key, draft);
    const publish = vi.fn().mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'GITHUB_ACCESS_DENIED' }));
    render(<CommentComposer client={clientWith({ publish })} reference={reference} account={account} onPublished={vi.fn()} />, { wrapper });
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('publicationCheckFailed: Permission denied'));
    expect(readDraft(key)).toEqual(draft);
    expect((screen.getByRole('textbox', { name: 'comment' }) as HTMLTextAreaElement).disabled).toBe(false);
    expect(publish).toHaveBeenCalledWith({ ...reference, expectedAccount: account, threadId: null, body: draft.body, requestId: draft.requestId, reconcileOnly: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'comment' }), { target: { value: 'Updated after lookup failed' } });
    expect(readDraft(key)).toMatchObject({ body: 'Updated after lookup failed', submittedBody: draft.body, requestId: draft.requestId, uncertain: true });
    publish.mockResolvedValueOnce(commentNode('ORIGINAL')).mockResolvedValueOnce(commentNode('UPDATED'));
    fireEvent.click(screen.getByRole('button', { name: 'publishComment' }));
    await waitFor(() => expect(readDraft(key).body).toBe(''));
    const [, lookup, send] = publish.mock.calls.map(([input]) => input);
    expect(lookup).toMatchObject({ body: draft.body, requestId: draft.requestId, reconcileOnly: true });
    expect(send).toMatchObject({ body: 'Updated after lookup failed', reconcileOnly: false });
    expect(send.requestId).not.toBe(draft.requestId);
  });

  it.each([true, false])('automatically checks a failed send response and restores an editable draft without resending (found: %s)', async (found) => {
    const account = `alice-${crypto.randomUUID()}`;
    const key = `${account}/${reference.repository}/${reference.number}/conversation`;
    const publish = vi.fn().mockRejectedValueOnce(new Error('Lost response'));
    if (found) publish.mockResolvedValueOnce(commentNode('C1'));
    else publish.mockRejectedValueOnce(Object.assign(new Error('Absent from complete list'), { code: 'PR_COMMENT_NOT_FOUND' }));
    const onPublished = vi.fn();
    render(<CommentComposer client={clientWith({ publish })} reference={reference} account={account} onPublished={onPublished} />, { wrapper });
    fireEvent.change(screen.getByRole('textbox', { name: 'comment' }), { target: { value: 'Draft body' } });
    fireEvent.click(screen.getByRole('button', { name: 'publishComment' }));
    await waitFor(() => expect(readDraft(key).uncertain).toBe(false));
    expect(publish.mock.calls.map(([input]) => input.reconcileOnly)).toEqual([false, true]);
    expect(publish.mock.calls[1][0].requestId).toBe(publish.mock.calls[0][0].requestId);
    expect(readDraft(key).body).toBe(found ? '' : 'Draft body');
    expect((screen.getByRole('textbox', { name: 'comment' }) as HTMLTextAreaElement).disabled).toBe(false);
    if (found) { expect(onPublished).toHaveBeenCalledOnce(); expect(notifyError).not.toHaveBeenCalled(); }
    else expect(notifyError).toHaveBeenCalledWith('commentFailed: Lost response');
  });

  it('does not overwrite a newer draft when an earlier send fails after navigation', async () => {
    const account = `alice-${crypto.randomUUID()}`;
    const key = `${account}/${reference.repository}/${reference.number}/conversation`;
    let rejectSend!: (reason: unknown) => void;
    const client = clientWith({ publish: vi.fn(() => new Promise((_, reject) => { rejectSend = reject; })) });
    const view = render(<CommentComposer client={client} reference={reference} account={account} onPublished={vi.fn()} />, { wrapper });
    fireEvent.change(screen.getByRole('textbox', { name: 'comment' }), { target: { value: 'Original' } });
    fireEvent.click(screen.getByRole('button', { name: 'publishComment' }));
    view.unmount();
    const next = { body: 'New draft', requestId: crypto.randomUUID(), uncertain: false };
    saveDraft(key, next);
    await act(async () => rejectSend(Object.assign(new Error('Permission denied'), { code: 'GITHUB_ACCESS_DENIED' })));
    expect(readDraft(key)).toEqual(next);
  });

  it('refreshes a changed account after refusing a send and keeps the draft with its original owner', async () => {
    const account = `alice-${crypto.randomUUID()}`;
    const key = `${account}/${reference.repository}/${reference.number}/conversation`;
    const connection = vi.fn()
      .mockResolvedValueOnce({ state: 'connected', login: account })
      .mockResolvedValueOnce({ state: 'connected', login: 'bob' });
    const publish = vi.fn().mockRejectedValue(Object.assign(new Error('Account changed'), { code: 'PR_ACCOUNT_CHANGED' }));
    const client = clientWith({ connection, publish });
    const onPublished = vi.fn();
    function ConnectedComposer() {
      const auth = useConnection(client);
      const owner = auth.connection?.login;
      return owner ? <CommentComposer key={owner} client={auth.client} reference={reference} account={owner} onPublished={onPublished} /> : null;
    }
    render(<ConnectedComposer />, { wrapper });
    fireEvent.change(await screen.findByRole('textbox', { name: 'comment' }), { target: { value: 'Alice draft' } });
    const requestId = readDraft(key).requestId;
    fireEvent.click(screen.getByRole('button', { name: 'publishComment' }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('accountChanged'));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'comment' }) as HTMLTextAreaElement).value).toBe(''));
    expect(connection).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ ...reference, expectedAccount: account, threadId: null, body: 'Alice draft', requestId, reconcileOnly: false });
    expect(readDraft(key)).toMatchObject({ body: 'Alice draft', requestId, uncertain: false });
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('closes a stale merge confirmation and refreshes the connection without retrying as the new account', async () => {
    const pr = await detail();
    const connection = vi.fn()
      .mockResolvedValueOnce({ state: 'connected', login: 'alice' })
      .mockResolvedValueOnce({ state: 'connected', login: 'bob' });
    const perform = vi.fn().mockRejectedValue(Object.assign(new Error('Account changed'), { code: 'PR_ACCOUNT_CHANGED' }));
    const client = clientWith({ connection, act: perform });
    const hook = renderHook(() => useConnection(client), { wrapper });
    await waitFor(() => expect(hook.result.current.connection?.login).toBe('alice'));
    render(<MergeActions client={hook.result.current.client} detail={pr} account="alice" onUpdated={vi.fn()} />, { wrapper });
    fireEvent.keyDown(screen.getByRole('button', { name: 'merge' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'merge' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'merge' }));
    await waitFor(() => expect(hook.result.current.connection?.login).toBe('bob'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(notifyError).toHaveBeenCalledWith('accountChanged');
    expect(perform).toHaveBeenCalledOnce();
    expect(perform.mock.calls[0][0]).toMatchObject({ expectedAccount: 'alice' });
  });

  it.each([true, false])('allows a BEHIND revision only through the required queue (queue: %s)', async (queueRequired) => {
    const pr = { ...await detail(), mergeState: 'BEHIND', queueRequired };
    const perform = vi.fn(async () => ({ state: 'queued' as const }));
    render(<MergeActions client={clientWith({ act: perform })} detail={pr} account="alice" onUpdated={vi.fn()} />, { wrapper });
    fireEvent.keyDown(screen.getByRole('button', { name: 'merge' }), { key: 'Enter' });
    const item = await screen.findByRole('menuitem', { name: queueRequired ? 'enqueue' : 'merge' });
    fireEvent.click(item);
    if (!queueRequired) {
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(perform).not.toHaveBeenCalled();
      return;
    }
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'enqueue' }));
    await waitFor(() => expect(perform).toHaveBeenCalledOnce());
    expect(perform.mock.calls[0][0]).toMatchObject({ expectedAccount: 'alice', headSha: head, baseBranch: 'main', action: 'enqueue' });
  });

  it('submits the account, revision and target shown when confirmation opened even if the page updates', async () => {
    const pr: PullRequestDetail = await detail();
    const perform = vi.fn(async () => ({ state: 'merged' as const }));
    const client = clientWith({ act: perform });
    const view = render(<MergeActions client={client} detail={pr} account="alice" onUpdated={vi.fn()} />, { wrapper });
    fireEvent.keyDown(screen.getByRole('button', { name: 'merge' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'merge' }));
    const dialog = await screen.findByRole('dialog');
    view.rerender(<MergeActions client={client} detail={{ ...pr, headSha: 'd'.repeat(40), baseBranch: 'develop' }} account="bob" onUpdated={vi.fn()} />);
    fireEvent.click(within(dialog).getByRole('button', { name: 'merge' }));
    await waitFor(() => expect(perform).toHaveBeenCalledOnce());
    expect(perform.mock.calls[0][0]).toMatchObject({ expectedAccount: 'alice', headSha: head, baseBranch: 'main', method: 'SQUASH', action: 'merge' });
  });
});
