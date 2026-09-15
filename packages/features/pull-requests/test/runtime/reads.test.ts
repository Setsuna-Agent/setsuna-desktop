import { describe, expect, it, vi } from 'vitest';
import { actionInputCodec, commentInputCodec, detailCodec, patchInputCodec, referenceCodec } from '../../src/contracts/index.js';
import { readChecks } from '../../src/runtime/checks.js';
import { readDiscussions, readThread } from '../../src/runtime/discussions.js';
import { listRequests, readRequest } from '../../src/runtime/pull-requests.js';
import { base, checkNode, commentNode, githubFixture, head, page, reference, repositoryNode, summaryNode } from '../support/github-fixture.js';

describe('GitHub PR projections', () => {
  it('uses any released request slot and cancels queued work before it reaches GitHub', async () => {
    const gates = new Map<string, (value: unknown) => void>();
    const { api, request } = githubFixture(({ path }) => new Promise((resolve) => { gates.set(path, resolve); }));
    const first = Array.from({ length: 4 }, (_, index) => api.request(`/initial/${index}`));
    const controller = new AbortController();
    const cancelled = expect(api.request('/cancelled', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const next = api.request('/next');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    controller.abort();
    await cancelled;
    gates.get('/initial/0')!({});
    await vi.waitFor(() => expect(gates.has('/next')).toBe(true));
    expect(gates.has('/cancelled')).toBe(false);
    for (const release of gates.values()) release({});
    await Promise.all([...first, next]);
  });

  it('continues filtered repository pagination beyond 1,000 results and retains a continuation when a scan has no matches', async () => {
    const cursors: unknown[] = [];
    const { api } = githubFixture(({ variables }) => {
      cursors.push(variables.cursor);
      const offset = Number(variables.cursor ?? 1000);
      return { repository: { pullRequests: page([summaryNode(offset, offset === 1006 ? 'Alice' : 'bob')], String(offset + 1)) } };
    });
    const input = { repository: reference.repository, cursor: null, filters: { state: 'open' as const, author: '@alice', search: '1006' } };
    const first = await listRequests(api, input);
    expect(first).toEqual({ items: [], cursor: '1005' });
    const second = await listRequests(api, { ...input, cursor: first.cursor });
    expect(second.items.map((item) => item.number)).toEqual([1006]);
    expect(second.cursor).toBe('1007');
    expect(cursors).toEqual([null, '1001', '1002', '1003', '1004', '1005', '1006']);
  });

  it('uses the checks commit consistently and distinguishes required checks, legacy statuses, and partial API failures', async () => {
    let partial = false;
    const { api } = githubFixture(({ query }) => {
      if (partial) return Response.json({ data: { repository: {} }, errors: [{ message: 'Resource unavailable' }] });
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      return { repository: { object: { statusCheckRollup: { contexts: page([
        { ...checkNode(1, 'test', 'FAILURE'), summary: 'Failed assertion' },
        { __typename: 'StatusContext', id: 'SC1', context: 'deploy', state: 'PENDING', isRequired: false, targetUrl: 'javascript:alert(1)', description: 'Waiting', createdAt: '2026-09-14' },
      ]) } } } };
    });
    const detail = await readRequest(api, reference);
    expect(detail).toMatchObject({ checksState: 'SUCCESS', checksCommit: 'c'.repeat(40) });
    const checks = await readChecks(api, { ...reference, commitSha: detail.checksCommit!, cursor: null });
    expect(checks).toMatchObject({ cursor: null, items: [{ required: true, conclusion: 'FAILURE' }, { required: false, conclusion: null, url: null }] });
    partial = true;
    await expect(readRequest(api, reference)).rejects.toMatchObject({ code: 'GITHUB_REQUEST_FAILED' });
  });

  it('preserves outdated review context, paginates commit discussions, and rejects a thread from a different PR', async () => {
    const { api } = githubFixture(({ query, variables }) => {
      if (query.includes('reviewThreads(')) return { repository: { pullRequest: { reviewThreads: page([{
        id: 'T1', isResolved: true, isOutdated: true, viewerCanReply: true, path: 'src/app.ts', line: null, originalLine: 18, diffSide: 'LEFT',
        comments: page([{ ...commentNode('C1'), diffHunk: '@@ -18 +18 @@\n-old\n+new', commit: { oid: head } }], 'replies-2'),
      }], 'threads-2') } } };
      if (query.includes('timelineItems(')) {
        expect(query).toContain('PULL_REQUEST_COMMIT_COMMENT_THREAD');
        return { repository: { pullRequest: { timelineItems: page([{ id: 'CT1', commit: { oid: head }, comments: page([commentNode('C2')], 'commit-replies-2') }]) } } };
      }
      if (variables.id === 'CT1') return { node: { comments: page([commentNode('C3')]) } };
      return { node: { id: 'T1', viewerCanReply: true, pullRequest: { number: 99, repository: { nameWithOwner: reference.repository } }, comments: page([]) } };
    });
    expect(await readDiscussions(api, { ...reference, kind: 'threads', cursor: null })).toMatchObject({ cursor: 'threads-2', items: [{ resolved: true, outdated: true, line: 18, side: 'LEFT', replyCursor: 'replies-2' }] });
    const commits = await readDiscussions(api, { ...reference, kind: 'commits', cursor: null });
    expect(commits.items[0].comments.map((item) => item.id)).toEqual(['C2', 'C3']);
    await expect(readThread(api, { ...reference, threadId: 'T1', cursor: null })).rejects.toMatchObject({ code: 'PR_NOT_FOUND' });
  });

  it('retains reviewer avatars across both paginated sources and deduplicates renewed review requests', async () => {
    const alice = { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' };
    const bob = { login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/u/2' };
    const teamAvatarUrl = 'https://avatars.githubusercontent.com/t/3';
    const { api, request } = githubFixture(({ query, variables }) => {
      if (variables.cursor === 'reviews-2') return { repository: { pullRequest: { latestReviews: page([{ author: bob, state: 'COMMENTED' }]) } } };
      if (variables.cursor === 'requests-2') return { repository: { pullRequest: { reviewRequests: page([
        { requestedReviewer: alice }, { requestedReviewer: { name: 'design', teamAvatarUrl: null } },
      ]) } } };
      if (!query.includes('viewerPermission')) throw new Error('Unexpected reviewer page');
      const repository = repositoryNode();
      return { repository: { ...repository, pullRequest: { ...repository.pullRequest,
        latestReviews: page([{ author: alice, state: 'APPROVED' }], 'reviews-2'),
        reviewRequests: page([{ requestedReviewer: { name: 'maintainers', teamAvatarUrl } }, { requestedReviewer: null }], 'requests-2'),
      } } };
    });
    const detail = detailCodec.parse(await readRequest(api, reference));
    expect(detail.reviewers).toEqual([
      { name: 'alice', avatarUrl: alice.avatarUrl, state: 'REQUESTED' },
      { name: 'bob', avatarUrl: bob.avatarUrl, state: 'COMMENTED' },
      { name: 'maintainers', avatarUrl: teamAvatarUrl, state: 'REQUESTED' },
      { name: 'design', avatarUrl: null, state: 'REQUESTED' },
    ]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('rejects paths and mutation inputs that cannot identify a valid PR revision', () => {
    for (const repository of ['owner/..', '../repo', 'owner/repo/extra', 'https://github.com/owner/repo']) expect(() => referenceCodec.parse({ repository, number: 1 })).toThrow();
    for (const path of ['/etc/passwd', '../secret', 'src/../../secret', 'src/\0file']) expect(() => patchInputCodec.parse({ ...reference, baseSha: base, headSha: head, path })).toThrow();
    expect(() => actionInputCodec.parse({ ...reference, expectedAccount: 'alice', headSha: '--upload-pack=evil', baseBranch: 'main', action: 'merge', method: 'SQUASH' })).toThrow();
    expect(() => actionInputCodec.parse({ ...reference, expectedAccount: 'alice', headSha: head, baseBranch: 'main', action: 'admin-merge', method: 'SQUASH' })).toThrow();
    expect(() => actionInputCodec.parse({ ...reference, expectedAccount: 'alice', headSha: head, action: 'merge', method: 'SQUASH' })).toThrow();
    expect(() => referenceCodec.parse({ ...reference, number: 1.5 })).toThrow();
  });

  it('requires the expected account at the write boundary', () => {
    const action = { ...reference, headSha: head, baseBranch: 'main', action: 'merge', method: 'SQUASH' };
    const comment = { ...reference, body: 'Hello', threadId: null, requestId: 'draft_1234567890123456', reconcileOnly: false };
    for (const [codec, input] of [[actionInputCodec, action], [commentInputCodec, comment]] as const) {
      expect(() => codec.parse(input)).toThrow();
      expect(() => codec.parse({ ...input, expectedAccount: '' })).toThrow();
      expect(codec.parse({ ...input, expectedAccount: 'alice' })).toMatchObject({ expectedAccount: 'alice' });
    }
  });
});
