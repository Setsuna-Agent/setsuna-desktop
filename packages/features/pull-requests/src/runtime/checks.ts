import type { PullRequestCheck, PullRequestChecksInput } from '../contracts/index.js';
import { GitHubApi, nextCursor, pageFields, repoVariables, type Page } from './github-api.js';

export type CheckNode = {
  __typename: 'CheckRun'; id: string; databaseId: number | null; name: string; status: string; conclusion: string | null; isRequired: boolean;
  detailsUrl: string | null; startedAt: string | null; completedAt: string | null; summary: string | null;
  checkSuite: {
    createdAt: string; app: { id: string; name: string } | null;
    workflowRun: { event: string; workflow: { id: string } } | null;
  };
} | {
  __typename: 'StatusContext'; id: string; context: string; state: string; isRequired: boolean;
  targetUrl: string | null; description: string | null; createdAt: string;
};
export type CheckRollup = { state: string; contexts: Page<CheckNode> };
const checkNodeFields = `__typename
  ... on CheckRun {
    id databaseId name status conclusion isRequired(pullRequestNumber: $number) detailsUrl startedAt completedAt summary
    checkSuite { createdAt app { id name } workflowRun { event workflow { id } } }
  }
  ... on StatusContext { id context state isRequired(pullRequestNumber: $number) targetUrl description createdAt }`;
export const checkRollupFields = `state contexts(first: 100) { ${pageFields} nodes { ${checkNodeFields} } }`;

function checkKey(node: CheckNode): string {
  if (node.__typename === 'StatusContext') return JSON.stringify(['status', node.context]);
  const { app, workflowRun } = node.checkSuite;
  return JSON.stringify(['run', app?.id, workflowRun?.workflow.id, workflowRun?.event, node.name]);
}
function compareChecks(left: CheckNode, right: CheckNode): number {
  // Run IDs order new attempts even before they start, including reruns of an older suite.
  if (left.__typename === 'CheckRun' && right.__typename === 'CheckRun' && left.databaseId !== null && right.databaseId !== null) {
    const order = left.databaseId - right.databaseId;
    if (order) return order;
  }
  const createdAt = (node: CheckNode) => node.__typename === 'CheckRun' ? node.checkSuite.createdAt : node.createdAt;
  const created = createdAt(left).localeCompare(createdAt(right));
  if (created || left.__typename !== 'CheckRun' || right.__typename !== 'CheckRun') return created;
  return (left.startedAt ?? '').localeCompare(right.startedAt ?? '');
}
function latestChecks(nodes: CheckNode[]): PullRequestCheck[] {
  const latest = new Map<string, CheckNode>();
  for (const node of nodes) {
    const key = checkKey(node);
    const previous = latest.get(key);
    if (!previous || compareChecks(node, previous) >= 0) latest.set(key, node);
  }
  return [...latest.values()].map(normalizeCheck);
}
export function summarizeChecks(checks: PullRequestCheck[]) {
  let passed = 0;
  let failed = false;
  for (const check of checks) {
    const state = check.conclusion ?? check.state;
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) passed += 1;
    else if (['ERROR', 'FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'CANCELLED', 'STARTUP_FAILURE'].includes(state)) failed = true;
  }
  return {
    checksState: !checks.length ? null : failed ? 'FAILURE' : passed === checks.length ? 'SUCCESS' : 'PENDING',
    checksProgress: { passed, total: checks.length },
  };
}
function normalizeCheck(node: CheckNode): PullRequestCheck {
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
export async function collectChecks(api: GitHubApi, input: PullRequestChecksInput, initial: CheckRollup | null | undefined, signal?: AbortSignal) {
  const nodes: CheckNode[] = [...(initial?.contexts.nodes ?? [])];
  let cursor = initial ? nextCursor(initial.contexts) : null;
  // Duplicates can span pages and suites. Finish pagination before choosing the current runs.
  if (initial === undefined || cursor) {
    do {
      const result = await api.graphql<{ repository: { object: { statusCheckRollup: CheckRollup | null } | null } }>(`
        query($owner: String!, $name: String!, $sha: GitObjectID!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) { object(oid: $sha) { ... on Commit { statusCheckRollup {
            state contexts(first: 100, after: $cursor) { ${pageFields} nodes { ${checkNodeFields} } }
          } } } }
        }`, { ...repoVariables(input.repository), sha: input.commitSha, number: input.number, cursor }, signal);
      const page = result.repository.object?.statusCheckRollup?.contexts;
      nodes.push(...(page?.nodes ?? []));
      cursor = page ? nextCursor(page) : null;
    } while (cursor);
  }
  return latestChecks(nodes);
}
export async function readChecks(api: GitHubApi, input: PullRequestChecksInput, signal?: AbortSignal) {
  // Return one complete, deduplicated result instead of exposing historical runs page by page.
  return { items: await collectChecks(api, input, undefined, signal), cursor: null };
}
