import type { PullRequestDetail, PullRequestListInput, PullRequestListResult, PullRequestReference, PullRequestSummary, MergeMethod } from '../contracts/index.js';
import { actor, actorFields, GitHubApi, nextCursor, pageFields, repoVariables, type Actor, type Page } from './github-api.js';
import { collectChecks, summarizeChecks, checkRollupFields, type CheckRollup } from './checks.js';

const summaryFields = (checksFields = 'state') => `id number title url state isDraft updatedAt headRefOid author { ${actorFields} }
  commits(last: 1) { nodes { commit { statusCheckRollup { ${checksFields} } } } }`;
type SummaryNode<Rollup extends { state: string } = { state: string }> = {
  id: string; number: number; title: string; url: string; state: PullRequestSummary['state']; isDraft: boolean;
  updatedAt: string; headRefOid: string; author: Actor;
  commits: { nodes: { commit: { statusCheckRollup: Rollup | null } }[] };
};
export function summary(node: SummaryNode, repository: string): PullRequestSummary {
  return {
    id: node.id, repository, number: node.number, title: node.title, url: node.url, state: node.state,
    draft: node.isDraft, updatedAt: node.updatedAt, headSha: node.headRefOid, author: actor(node.author),
    checksState: node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
  };
}
export async function listRequests(api: GitHubApi, input: PullRequestListInput, signal?: AbortSignal): Promise<PullRequestListResult> {
  const states = input.filters.state === 'all' ? ['OPEN', 'CLOSED', 'MERGED']
    : input.filters.state === 'merged' ? ['MERGED'] : input.filters.state === 'closed' ? ['CLOSED'] : ['OPEN'];
  let cursor = input.cursor;
  const items: PullRequestSummary[] = [];
  // Repository connections have no 1,000-result search cap. Scan bounded pages for author/text filters.
  for (let scan = 0; scan < 5; scan += 1) {
    const result = await api.graphql<{ repository: { pullRequests: Page<SummaryNode> } }>(`
      query($owner: String!, $name: String!, $states: [PullRequestState!], $cursor: String) {
        repository(owner: $owner, name: $name) { pullRequests(first: 50, after: $cursor, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
          ${pageFields} nodes { ${summaryFields()} }
        } }
      }`, { ...repoVariables(input.repository), states, cursor }, signal);
    const page = result.repository.pullRequests;
    for (const node of page.nodes) {
      const item = summary(node, input.repository);
      if (input.filters.state === 'draft' && !item.draft) continue;
      if (input.filters.author && item.author.login.toLowerCase() !== input.filters.author.replace(/^@/u, '').toLowerCase()) continue;
      const search = input.filters.search.toLowerCase();
      if (search && !`${item.title} #${item.number}`.toLowerCase().includes(search)) continue;
      items.push(item);
    }
    cursor = nextCursor(page);
    if (items.length || !cursor) break;
  }
  return { items, cursor };
}

// Team avatars are nullable, unlike Actor avatars, so use a distinct GraphQL response field.
const requestedReviewerFields = `requestedReviewer { ... on User { ${actorFields} } ... on Team { name teamAvatarUrl: avatarUrl } ... on Mannequin { ${actorFields} } }`;
type Reviewer = { requestedReviewer: { login?: string; name?: string; avatarUrl?: string; teamAvatarUrl?: string | null } | null };
type Review = { author: Actor; state: string };
type DetailNode = SummaryNode<CheckRollup> & {
  body: string; createdAt: string; baseRefName: string; headRefName: string; baseRefOid: string;
  headRepository: { nameWithOwner: string } | null; additions: number; deletions: number; changedFiles: number;
  comments: { totalCount: number }; reviewThreads: { totalCount: number };
  mergeable: string; mergeStateStatus: string; reviewDecision: string | null; viewerCanEnableAutoMerge: boolean;
  viewerCanDisableAutoMerge: boolean; locked: boolean;
  autoMergeRequest: { mergeMethod: MergeMethod; enabledBy: Actor } | null;
  mergeQueue: { id: string } | null; mergeQueueEntry: { state: string } | null;
  potentialMergeCommit: { oid: string; statusCheckRollup: CheckRollup | null } | null;
  reviewRequests: Page<Reviewer>; latestReviews: Page<Review>;
};
type RepositoryDetails = {
  viewerPermission: string | null; isArchived: boolean; mergeCommitAllowed: boolean; squashMergeAllowed: boolean; rebaseMergeAllowed: boolean;
  pullRequest: DetailNode;
};
export async function readRequest(api: GitHubApi, input: PullRequestReference, signal?: AbortSignal): Promise<PullRequestDetail> {
  const { repository } = await api.graphql<{ repository: RepositoryDetails }>(`
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        viewerPermission isArchived mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
        pullRequest(number: $number) {
          ${summaryFields(checkRollupFields)} body createdAt baseRefName headRefName baseRefOid headRepository { nameWithOwner }
          additions deletions changedFiles comments { totalCount } reviewThreads { totalCount }
          mergeable mergeStateStatus reviewDecision viewerCanEnableAutoMerge viewerCanDisableAutoMerge locked
          autoMergeRequest { mergeMethod enabledBy { ${actorFields} } }
          mergeQueue { id } mergeQueueEntry { state }
          potentialMergeCommit { oid statusCheckRollup { ${checkRollupFields} } }
          reviewRequests(first: 100) { ${pageFields} nodes { ${requestedReviewerFields} } }
          latestReviews(first: 100) { ${pageFields} nodes { state author { ${actorFields} } } }
        }
      }
    }`, { ...repoVariables(input.repository), number: input.number }, signal);
  const node = repository.pullRequest;
  if (!node) throw new Error('Pull request not found.');
  const reviewers = new Map<string, PullRequestDetail['reviewers'][number]>();
  await collectReviewers(api, input, node, reviewers, signal);
  const allowedMethods: MergeMethod[] = [];
  if (repository.mergeCommitAllowed) allowedMethods.push('MERGE');
  if (repository.squashMergeAllowed) allowedMethods.push('SQUASH');
  if (repository.rebaseMergeAllowed) allowedMethods.push('REBASE');
  const rollup = node.potentialMergeCommit?.statusCheckRollup ?? node.commits.nodes[0]?.commit.statusCheckRollup ?? null;
  const checksCommit = node.potentialMergeCommit?.statusCheckRollup ? node.potentialMergeCommit.oid : node.headRefOid;
  const checks = await collectChecks(api, { ...input, commitSha: checksCommit, cursor: null }, rollup, signal);
  return {
    ...summary(node, input.repository), ...summarizeChecks(checks), body: node.body, createdAt: node.createdAt,
    baseBranch: node.baseRefName, headBranch: node.headRefName, baseSha: node.baseRefOid,
    headRepository: node.headRepository?.nameWithOwner ?? null, additions: node.additions, deletions: node.deletions,
    fileCount: node.changedFiles, commentCount: node.comments.totalCount + node.reviewThreads.totalCount,
    mergeable: node.mergeable, mergeState: node.mergeStateStatus, reviewDecision: node.reviewDecision,
    canComment: (!node.locked || ['ADMIN', 'MAINTAIN', 'WRITE'].includes(repository.viewerPermission ?? '')) && !repository.isArchived,
    canMerge: ['ADMIN', 'MAINTAIN', 'WRITE'].includes(repository.viewerPermission ?? '') && !repository.isArchived,
    canEnableAutoMerge: node.viewerCanEnableAutoMerge, canDisableAutoMerge: node.viewerCanDisableAutoMerge,
    allowedMethods, autoMerge: node.autoMergeRequest ? { method: node.autoMergeRequest.mergeMethod, author: actor(node.autoMergeRequest.enabledBy) } : null,
    queueRequired: Boolean(node.mergeQueue), queueState: node.mergeQueueEntry?.state ?? null,
    reviewers: [...reviewers.values()],
    checksCommit,
  };
}

async function collectReviewers(api: GitHubApi, input: PullRequestReference, node: DetailNode, result: Map<string, PullRequestDetail['reviewers'][number]>, signal?: AbortSignal) {
  for (const kind of ['latestReviews', 'reviewRequests'] as const) {
    let page: Page<Review | Reviewer> = node[kind];
    while (true) {
      for (const item of page.nodes) {
        if ('state' in item) {
          const author = actor(item.author);
          result.set(author.login, { name: author.login, avatarUrl: author.avatarUrl, state: item.state });
        } else if (item.requestedReviewer) {
          const reviewer = item.requestedReviewer;
          const name = reviewer.login ?? reviewer.name ?? '';
          result.set(name, { name, avatarUrl: reviewer.avatarUrl ?? reviewer.teamAvatarUrl ?? null, state: 'REQUESTED' });
        }
      }
      const cursor = nextCursor(page);
      if (!cursor) break;
      const selection = kind === 'latestReviews' ? `state author { ${actorFields} }` : requestedReviewerFields;
      const next = await api.graphql<{ repository: { pullRequest: Record<typeof kind, Page<Review | Reviewer>> } }>(`
        query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${kind}(first: 100, after: $cursor) { ${pageFields} nodes { ${selection} } } } }
        }`, { ...repoVariables(input.repository), number: input.number, cursor }, signal);
      page = next.repository.pullRequest[kind];
    }
  }
}
