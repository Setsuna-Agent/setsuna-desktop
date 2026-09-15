import { vi } from 'vitest';
import { GitHubApi, type GitHubTransport } from '../../src/runtime/github-api.js';
import type { CheckRollup } from '../../src/runtime/checks.js';

export const head = 'a'.repeat(40);
export const base = 'b'.repeat(40);
export const reference = { repository: 'owner/repo', number: 12 };
export const page = <T>(nodes: T[], cursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: cursor !== null, endCursor: cursor } });
export const commentNode = (id: string, body = id) => ({ id, databaseId: 1, body, createdAt: '2026-09-14T01:00:00Z', url: 'https://github.com/owner/repo/pull/12#comment', author: { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' } });
export const summaryNode = (number: number, login = 'alice') => ({
  id: `PR_${number}`, number, title: `Change ${number}`, url: `https://github.com/owner/repo/pull/${number}`,
  state: 'OPEN' as const, isDraft: false, updatedAt: '2026-09-14T01:00:00Z', headRefOid: head,
  author: { login, avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
  commits: { nodes: [{ commit: { statusCheckRollup: {
    state: 'PENDING', contexts: { totalCount: 1, checkRunCount: 1, statusContextCount: 0, checkRunCountsByState: [{ state: 'PENDING', count: 1 }], statusContextCountsByState: [] },
  } as CheckRollup | null } }] },
});
export function repositoryNode() {
  return {
    viewerPermission: 'WRITE', isArchived: false, mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false,
    pullRequest: {
      ...summaryNode(12), body: 'Description', createdAt: '2026-09-13T01:00:00Z', baseRefName: 'main', headRefName: 'feature', baseRefOid: base,
      headRepository: { nameWithOwner: 'owner/repo' }, additions: 2, deletions: 1, changedFiles: 1,
      comments: { totalCount: 0 }, reviewThreads: { totalCount: 0 }, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null,
      viewerCanEnableAutoMerge: true, viewerCanDisableAutoMerge: false, locked: false, autoMergeRequest: null,
      mergeQueue: null as { id: string } | null, mergeQueueEntry: null,
      potentialMergeCommit: { oid: 'c'.repeat(40), statusCheckRollup: {
        state: 'SUCCESS', contexts: { totalCount: 1, checkRunCount: 1, statusContextCount: 0, checkRunCountsByState: [{ state: 'SUCCESS', count: 1 }], statusContextCountsByState: [] },
      } } as { oid: string; statusCheckRollup: CheckRollup | null } | null,
      reviewRequests: page([]), latestReviews: page([]),
    },
  };
}
type Request = { path: string; method: string; query: string; variables: Record<string, unknown>; body: Record<string, unknown> };
export function githubFixture(respond: (request: Request) => unknown | Promise<unknown>) {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const value = await respond({ path, method: init?.method ?? 'GET', query: body.query ?? '', variables: body.variables ?? {}, body });
    return value instanceof Response ? value : Response.json(path === '/graphql' ? { data: value } : value);
  });
  const connection: GitHubTransport = { request, gitEnvironment: vi.fn(async () => ({})) };
  return { api: new GitHubApi(connection), connection, request };
}
