import type { PullRequestCheck, PullRequestChecksInput, PullRequestDetail } from '../contracts/index.js';
import { GitHubApi, nextCursor, pageFields, repoVariables, type Page } from './github-api.js';

type StateCount = { state: string; count: number };
export type CheckRollup = {
  state: string;
  contexts: {
    totalCount: number; checkRunCount: number; statusContextCount: number;
    checkRunCountsByState: StateCount[] | null; statusContextCountsByState: StateCount[] | null;
  };
};
export const checkRollupFields = `state contexts(first: 1) {
  totalCount checkRunCount statusContextCount
  checkRunCountsByState { state count } statusContextCountsByState { state count }
}`;
export function checkProgress(rollup: CheckRollup | null): PullRequestDetail['checksProgress'] {
  if (!rollup) return { passed: 0, total: 0 };
  const counts = rollup.contexts;
  if ((counts.checkRunCount && !counts.checkRunCountsByState) || (counts.statusContextCount && !counts.statusContextCountsByState)) return null;
  // Rollup counts cover every page. Neutral/skipped runs satisfy GitHub checks too.
  const runs = (counts.checkRunCountsByState ?? []).reduce((sum, item) => sum + (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(item.state) ? item.count : 0), 0);
  const statuses = (counts.statusContextCountsByState ?? []).reduce((sum, item) => sum + (item.state === 'SUCCESS' ? item.count : 0), 0);
  return { passed: runs + statuses, total: counts.totalCount };
}

type CheckNode = {
  __typename: 'CheckRun'; id: string; name: string; status: string; conclusion: string | null; isRequired: boolean;
  detailsUrl: string | null; startedAt: string | null; completedAt: string | null; summary: string | null;
  checkSuite: { app: { name: string } | null };
} | {
  __typename: 'StatusContext'; id: string; context: string; state: string; isRequired: boolean;
  targetUrl: string | null; description: string | null; createdAt: string;
};
export function normalizeCheck(node: CheckNode): PullRequestCheck {
  if (node.__typename === 'CheckRun') return {
    id: node.id, name: node.name, source: node.checkSuite.app?.name ?? 'GitHub', state: node.status,
    conclusion: node.conclusion, required: node.isRequired, url: safeCheckUrl(node.detailsUrl),
    startedAt: node.startedAt, completedAt: node.completedAt, summary: node.summary ?? '',
  };
  return {
    id: node.id, name: node.context, source: 'Commit status', state: node.state,
    conclusion: node.state === 'PENDING' ? null : node.state, required: node.isRequired,
    url: safeCheckUrl(node.targetUrl), startedAt: node.createdAt, completedAt: null, summary: node.description ?? '',
  };
}
function safeCheckUrl(url: string | null): string | null {
  try { const value = new URL(url ?? ''); return value.protocol === 'https:' && !value.username && !value.password ? url : null; } catch { return null; }
}
export async function readChecks(api: GitHubApi, input: PullRequestChecksInput, signal?: AbortSignal) {
  const result = await api.graphql<{ repository: { object: { statusCheckRollup: { contexts: Page<CheckNode> } | null } | null } }>(`
    query($owner: String!, $name: String!, $sha: GitObjectID!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) { object(oid: $sha) { ... on Commit { statusCheckRollup {
        contexts(first: 100, after: $cursor) { ${pageFields} nodes {
          __typename ... on CheckRun { id name status conclusion isRequired(pullRequestNumber: $number) detailsUrl startedAt completedAt summary checkSuite { app { name } } }
          ... on StatusContext { id context state isRequired(pullRequestNumber: $number) targetUrl description createdAt }
        } }
      } } } }
    }`, { ...repoVariables(input.repository), sha: input.commitSha, number: input.number, cursor: input.cursor }, signal);
  const page = result.repository.object?.statusCheckRollup?.contexts;
  return { items: page?.nodes.map(normalizeCheck) ?? [], cursor: page ? nextCursor(page) : null };
}
