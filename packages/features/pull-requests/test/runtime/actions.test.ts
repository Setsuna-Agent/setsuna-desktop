import { describe, expect, it } from 'vitest';
import { PullRequestActions } from '../../src/runtime/actions.js';
import { commentResultCodec } from '../../src/contracts/models.js';
import { commentNode, githubFixture, head, page, reference, repositoryNode } from '../support/github-fixture.js';

const draft = { ...reference, expectedAccount: 'alice', body: 'Please check this.', threadId: null, requestId: 'draft_1234567890123456', reconcileOnly: false };
describe('PR writes', () => {
  it.each([null, 'T1'])('refuses a different account before sending or reconciling a draft (%s)', async (threadId) => {
    let login = 'bob';
    let switchDuringRead = true;
    let writes = 0;
    const { api } = githubFixture(({ path, query, variables }) => {
      if (path === '/user') return { login };
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (query.includes('mutation')) {
        writes += 1;
        const node = commentNode('C1', (variables.input as { body: string }).body);
        return threadId ? { addPullRequestReviewThreadReply: { comment: node } } : { addComment: { commentEdge: { node } } };
      }
      if (variables.cursor && switchDuringRead) login = 'bob';
      const comments = page([], variables.cursor ? null : 'next');
      return threadId
        ? { node: { id: threadId, viewerCanReply: true, pullRequest: { number: reference.number, repository: { nameWithOwner: reference.repository } }, comments } }
        : { repository: { pullRequest: { comments } } };
    });
    const actions = new PullRequestActions(api);
    const input = { ...draft, threadId };
    await expect(actions.publish(input)).rejects.toMatchObject({ code: 'PR_ACCOUNT_CHANGED' });
    login = 'alice';
    // Account changes while the full comment list is being read.
    await expect(actions.publish(input)).rejects.toMatchObject({ code: 'PR_ACCOUNT_CHANGED' });
    expect(writes).toBe(0);
    login = 'ALICE';
    switchDuringRead = false;
    await expect(actions.publish(input)).resolves.toMatchObject({ id: 'C1' });
    login = 'bob';
    // A cached success or recovery request must still belong to the expected account.
    await expect(actions.publish(input)).rejects.toMatchObject({ code: 'PR_ACCOUNT_CHANGED' });
    await expect(actions.publish({ ...input, reconcileOnly: true })).rejects.toMatchObject({ code: 'PR_ACCOUNT_CHANGED' });
    expect(writes).toBe(1);
  });

  it.each(['merge', 'enqueue', 'enable-auto-merge', 'disable-auto-merge'] as const)('checks the confirmed account before reading and writing %s', async (action) => {
    const repository = repositoryNode();
    repository.pullRequest.viewerCanDisableAutoMerge = true;
    repository.pullRequest.mergeQueue = action === 'enqueue' ? { id: 'Q1' } : null;
    let login = 'bob';
    let switchDuringRead = true;
    let writes = 0;
    const { api } = githubFixture(({ path, query }) => {
      if (path === '/user') return { login };
      if (query.includes('viewerPermission')) {
        if (switchDuringRead) login = 'bob';
        return { repository };
      }
      if (path.endsWith('/merge') || query.includes('mutation')) { writes += 1; return { merged: true }; }
      throw new Error('Unexpected request');
    });
    const actions = new PullRequestActions(api);
    const input = { ...reference, expectedAccount: 'alice', headSha: head, baseBranch: 'main', method: 'SQUASH' as const, action };
    await expect(actions.act(input)).rejects.toMatchObject({ code: 'PR_ACCOUNT_CHANGED' });
    login = 'alice';
    await expect(actions.act(input)).rejects.toMatchObject({ code: 'PR_ACCOUNT_CHANGED' });
    expect(writes).toBe(0);
    login = 'ALICE';
    switchDuringRead = false;
    await expect(actions.act(input)).resolves.toBeDefined();
    expect(writes).toBe(1);
  });

  it('lets GitHub validate a BEHIND queue entry and choose its merge method', async () => {
    const repository = repositoryNode();
    repository.pullRequest.mergeQueue = { id: 'Q1' };
    repository.pullRequest.mergeStateStatus = 'BEHIND';
    const writes: unknown[] = [];
    let rejectQueue = false;
    const { api } = githubFixture(({ path, query, variables }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository };
      if (query.includes('mutation')) {
        writes.push(variables.input);
        return rejectQueue ? Response.json({ errors: [{ type: 'UNPROCESSABLE', message: 'Required checks are not satisfied' }] }) : {};
      }
      throw new Error('Unexpected request');
    });
    const actions = new PullRequestActions(api);
    // REBASE is disabled for direct merges; enqueue does not send a merge method.
    const input = { ...reference, expectedAccount: 'alice', headSha: head, baseBranch: 'main', method: 'REBASE' as const, action: 'enqueue' as const };
    await expect(actions.act(input)).resolves.toEqual({ state: 'queued' });
    expect(writes).toEqual([{ pullRequestId: 'PR_12', expectedHeadOid: head }]);
    rejectQueue = true;
    await expect(actions.act(input)).rejects.toThrow('Required checks are not satisfied');
    expect(writes).toHaveLength(2);
  });

  it.each([null, 'T1'])('publishes a comment or reply with its original body and the correct target (%s)', async (threadId) => {
    let mutationInput: unknown;
    const { api } = githubFixture(({ path, query, variables }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (query.includes('mutation')) {
        mutationInput = variables.input;
        const result = commentNode('C1', (variables.input as { body: string }).body);
        return threadId ? { addPullRequestReviewThreadReply: { comment: result } } : { addComment: { commentEdge: { node: result } } };
      }
      if (threadId) return { node: { id: threadId, viewerCanReply: true, pullRequest: { number: reference.number, repository: { nameWithOwner: reference.repository } }, comments: page([]) } };
      return { repository: { pullRequest: { comments: page([]) } } };
    });
    const result = await new PullRequestActions(api).publish({ ...draft, threadId });
    expect(commentResultCodec.parse(result)).toMatchObject({ id: 'C1', body: draft.body, author: { login: 'alice' } });
    expect(mutationInput).toEqual({
      ...(threadId ? { pullRequestReviewThreadId: threadId } : { subjectId: 'PR_12' }),
      body: `${draft.body}\n<!-- setsuna-pr-comment:${draft.requestId} -->`, clientMutationId: draft.requestId,
    });
  });

  it.each(['account', 'pull request', 'comments'])('allows retrying the same draft after a failed %s read without attempting a write', async (stage) => {
    let fail = true;
    let writes = 0;
    const { api } = githubFixture(({ path, query, variables }) => {
      const currentStage = path === '/user' ? 'account' : query.includes('viewerPermission') ? 'pull request' : 'comments';
      if (fail && stage === currentStage) throw new Error('Read connection failed');
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (query.includes('mutation')) {
        writes += 1;
        return { addComment: { commentEdge: { node: commentNode('C1', (variables.input as { body: string }).body) } } };
      }
      return { repository: { pullRequest: { comments: page([]) } } };
    });
    const actions = new PullRequestActions(api);
    await expect(actions.publish(draft)).rejects.toMatchObject({ code: 'PR_COMMENT_NOT_SENT', message: 'Read connection failed' });
    expect(writes).toBe(0);
    fail = false;
    await expect(actions.publish(draft)).resolves.toMatchObject({ id: 'C1', body: draft.body });
    expect(writes).toBe(1);
  });

  it.each([
    () => Response.json({ message: 'Comment rejected' }, { status: 422 }),
    () => Response.json({ data: null, errors: [{ message: 'Comment rejected' }] }),
    () => Response.json({ data: { addComment: null }, errors: [{ type: 'UNPROCESSABLE', path: ['addComment'], message: 'Comment rejected' }] }),
  ])('keeps a GitHub rejection actionable and does not cache it as an uncertain write (%#)', async (failure) => {
    let writes = 0;
    const { api } = githubFixture(({ path, query, variables }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (query.includes('mutation')) {
        writes += 1;
        if (writes === 1) return failure();
        return { addComment: { commentEdge: { node: commentNode('C1', (variables.input as { body: string }).body) } } };
      }
      return { repository: { pullRequest: { comments: page([]) } } };
    });
    const actions = new PullRequestActions(api);
    await expect(actions.publish(draft)).rejects.toMatchObject({ code: 'PR_COMMENT_NOT_SENT', message: 'Comment rejected' });
    await expect(actions.publish(draft)).resolves.toMatchObject({ id: 'C1' });
    expect(writes).toBe(2);
  });

  it.each([
    () => Response.json({ message: 'Response failed' }, { status: 502 }),
    () => Response.json({ data: null, errors: [{ type: 'INTERNAL', message: 'Response failed' }] }),
    () => Response.json({ data: { addComment: { commentEdge: null } }, errors: [{ type: 'FORBIDDEN', path: ['addComment', 'commentEdge'], message: 'Response failed' }] }),
  ])('preserves an ambiguous write and its original error when GitHub cannot return the result (%#)', async (failure) => {
    let writes = 0;
    const { api } = githubFixture(({ path, query }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (query.includes('mutation')) { writes += 1; return failure(); }
      return { repository: { pullRequest: { comments: page([]) } } };
    });
    const actions = new PullRequestActions(api);
    await expect(actions.publish(draft)).rejects.toMatchObject({ code: 'PR_WRITE_UNCERTAIN', message: 'Response failed' });
    await expect(actions.publish(draft)).rejects.toMatchObject({ code: 'PR_WRITE_UNCERTAIN' });
    await expect(actions.publish({ ...draft, reconcileOnly: true })).rejects.toMatchObject({ code: 'PR_COMMENT_NOT_FOUND' });
    expect(writes).toBe(1);
  });

  it('coalesces concurrent sends, rejects reused draft IDs, and reconciles a lost response across restarts without sending again', async () => {
    const published: ReturnType<typeof commentNode>[] = [];
    let writes = 0;
    const { api } = githubFixture(({ path, query, variables }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('mutation')) {
        writes += 1;
        published.push(commentNode('C1', (variables.input as { body: string }).body));
        throw new Error('Connection lost after GitHub accepted the comment');
      }
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      return { repository: { pullRequest: { comments: page(published) } } };
    });
    const actions = new PullRequestActions(api);
    const results = await Promise.allSettled([actions.publish(draft), actions.publish(draft)]);
    expect(results).toMatchObject([{ status: 'rejected', reason: { code: 'PR_WRITE_UNCERTAIN' } }, { status: 'rejected', reason: { code: 'PR_WRITE_UNCERTAIN' } }]);
    expect(writes).toBe(1);
    await expect(actions.publish({ ...draft, body: 'Another draft' })).rejects.toThrow('another draft');
    const restored = new PullRequestActions(api);
    expect(await restored.publish({ ...draft, reconcileOnly: true })).toMatchObject({ id: 'C1', body: draft.body });
    expect(writes).toBe(1);
    published.length = 0;
    await expect(restored.publish({ ...draft, reconcileOnly: true })).rejects.toMatchObject({ code: 'PR_COMMENT_NOT_FOUND' });
    expect(writes).toBe(1);
  });

  it('does not reuse a successful send after logout and validates thread ownership before replying', async () => {
    let signedIn = true;
    const { api, request } = githubFixture(({ path, query }) => {
      if (path === '/user') return signedIn ? { login: 'alice' } : Response.json({ message: 'Signed out' }, { status: 401 });
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (query.includes('node(id:')) return { node: { id: 'T1', viewerCanReply: true, pullRequest: { number: 99, repository: { nameWithOwner: 'owner/repo' } }, comments: page([]) } };
      return { repository: { pullRequest: { comments: page([commentNode('C1', `${draft.body}\n<!-- setsuna-pr-comment:${draft.requestId} -->`)]) } } };
    });
    const actions = new PullRequestActions(api);
    await expect(actions.publish({ ...draft, threadId: 'T1' })).rejects.toMatchObject({ code: 'PR_COMMENT_NOT_SENT', message: 'This discussion does not belong to the selected pull request.' });
    const fresh = new PullRequestActions(api);
    await fresh.publish(draft);
    signedIn = false;
    await expect(fresh.publish(draft)).rejects.toMatchObject({ code: 'PR_COMMENT_NOT_SENT', message: 'Signed out' });
    expect(request.mock.calls.some(([, init]) => String(init?.body).includes('mutation'))).toBe(false);
  });

  it.each([null, 'T1'])('checks every page and releases an absent attempt for an explicit retry (%s)', async (threadId) => {
    let writes = 0;
    let lookupFails = false;
    const published: ReturnType<typeof commentNode>[] = [];
    const { api } = githubFixture(({ path, query, variables }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (query.includes('mutation')) {
        writes += 1;
        if (writes === 1) throw new Error('Lost connection');
        const node = commentNode('C1', (variables.input as { body: string }).body);
        published.push(node);
        return threadId ? { addPullRequestReviewThreadReply: { comment: node } } : { addComment: { commentEdge: { node } } };
      }
      if (lookupFails) throw new Error('Comments unavailable');
      const comments = variables.cursor ? page(published) : page([commentNode('OTHER', 'Unrelated comment')], 'next');
      return threadId
        ? { node: { id: threadId, viewerCanReply: true, pullRequest: { number: reference.number, repository: { nameWithOwner: reference.repository } }, comments } }
        : { repository: { pullRequest: { comments } } };
    });
    const actions = new PullRequestActions(api);
    const input = { ...draft, threadId };
    await expect(actions.publish(input)).rejects.toMatchObject({ code: 'PR_WRITE_UNCERTAIN' });
    lookupFails = true;
    await expect(actions.publish({ ...input, reconcileOnly: true })).rejects.toThrow('Comments unavailable');
    await expect(actions.publish(input)).rejects.toMatchObject({ code: 'PR_WRITE_UNCERTAIN' });
    expect(writes).toBe(1);
    lookupFails = false;
    await expect(actions.publish({ ...input, reconcileOnly: true })).rejects.toMatchObject({ code: 'PR_COMMENT_NOT_FOUND' });
    expect(writes).toBe(1);
    await expect(actions.publish(input)).resolves.toMatchObject({ id: 'C1' });
    expect(writes).toBe(2);
    // A new runtime must find the marker on the second page too.
    await expect(new PullRequestActions(api).publish({ ...input, reconcileOnly: true })).resolves.toMatchObject({ id: 'C1' });
    expect(writes).toBe(2);
  });

  it('waits for an in-flight send before declaring its publication absent', async () => {
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => { started = resolve; });
    const { api } = githubFixture(({ path, query }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (query.includes('mutation')) { started(); return new Promise((resolve) => { finish = resolve; }); }
      return { repository: { pullRequest: { comments: page([]) } } };
    });
    const actions = new PullRequestActions(api);
    const sending = actions.publish(draft);
    await dispatched;
    const checking = actions.publish({ ...draft, reconcileOnly: true });
    finish({ addComment: { commentEdge: { node: commentNode('C1') } } });
    await expect(sending).resolves.toMatchObject({ id: 'C1' });
    await expect(checking).resolves.toMatchObject({ id: 'C1' });
  });

  it('requires the reviewed head and repository permissions and passes a SHA guard to GitHub', async () => {
    const repository = repositoryNode();
    const writes: unknown[] = [];
    const { api } = githubFixture(({ path, query, body, variables }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository };
      if (path.endsWith('/merge')) { writes.push(body); return { merged: true }; }
      if (query.includes('mutation')) { writes.push(variables); return {}; }
      throw new Error('Unexpected request');
    });
    const actions = new PullRequestActions(api);
    const action = { ...reference, expectedAccount: 'alice', headSha: head, baseBranch: 'main', method: 'SQUASH' as const, action: 'merge' as const };
    await expect(actions.act({ ...action, headSha: 'd'.repeat(40) })).rejects.toMatchObject({ code: 'PR_CHANGED' });
    repository.viewerPermission = 'READ';
    await expect(actions.act(action)).rejects.toMatchObject({ code: 'PR_ACTION_BLOCKED' });
    repository.viewerPermission = 'WRITE';
    repository.pullRequest.mergeStateStatus = 'BLOCKED';
    await expect(actions.act(action)).rejects.toMatchObject({ code: 'PR_ACTION_BLOCKED' });
    expect(writes).toHaveLength(0);
    repository.pullRequest.mergeStateStatus = 'CLEAN';
    expect(await actions.act(action)).toEqual({ state: 'merged' });
    expect(writes).toEqual([{ sha: head, merge_method: 'squash' }]);
    repository.pullRequest.mergeQueue = { id: 'Q1' };
    await expect(actions.act(action)).rejects.toMatchObject({ code: 'PR_ACTION_BLOCKED' });
    expect(await actions.act({ ...action, action: 'enqueue' })).toEqual({ state: 'queued' });
    expect(writes[1]).toEqual({ input: { pullRequestId: 'PR_12', expectedHeadOid: head } });
    repository.pullRequest.viewerCanEnableAutoMerge = false;
    await expect(actions.act({ ...action, action: 'enable-auto-merge' })).rejects.toMatchObject({ code: 'PR_ACTION_BLOCKED' });
  });

  it.each(['merge', 'enqueue', 'enable-auto-merge'] as const)('rejects %s if the PR target changed while the head stayed the same', async (action) => {
    const repository = repositoryNode();
    repository.pullRequest.mergeQueue = action === 'enqueue' ? { id: 'Q1' } : null;
    const { api, request } = githubFixture(({ path }) => path === '/user' ? { login: 'alice' } : { repository });
    await expect(new PullRequestActions(api).act({
      ...reference, expectedAccount: 'alice', headSha: head, baseBranch: 'develop', method: 'SQUASH', action,
    })).rejects.toMatchObject({ code: 'PR_CHANGED' });
    expect(request.mock.calls.every(([path, init]) => path === '/user' || JSON.parse(String(init?.body)).query.trimStart().startsWith('query('))).toBe(true);
  });
});
