import { describe, expect, it } from 'vitest';
import { detailCodec } from '../../src/contracts/index.js';
import { readChecks, type CheckNode } from '../../src/runtime/checks.js';
import { readRequest } from '../../src/runtime/pull-requests.js';
import { checkNode, githubFixture, head, page, reference, repositoryNode } from '../support/github-fixture.js';

function statusNode(id: string, context: string, state = 'SUCCESS', createdAt = '2026-09-15T04:00:00Z'): CheckNode {
  return { __typename: 'StatusContext', id, context, state, createdAt, isRequired: false, targetUrl: null, description: null };
}

function checksFixture(nodes: CheckNode[], pageSize = 100) {
  const repository = repositoryNode();
  const contexts = (offset: number) => page(nodes.slice(offset, offset + pageSize), offset + pageSize < nodes.length ? String(offset + pageSize) : null);
  repository.pullRequest.potentialMergeCommit!.statusCheckRollup = { state: 'FAILURE', contexts: contexts(0) };
  let failContinuation = false;
  const fixture = githubFixture(({ query, variables }) => {
    if (query.includes('viewerPermission')) return { repository };
    expect(variables.sha).toBe('c'.repeat(40));
    if (variables.cursor && failContinuation) return Response.json({ data: { repository: {} }, errors: [{ message: 'Checks unavailable' }] });
    return { repository: { object: { statusCheckRollup: { state: 'FAILURE', contexts: contexts(Number(variables.cursor ?? 0)) } } } };
  });
  return { ...fixture, repository, failNextPage: () => { failContinuation = true; } };
}

async function readBoth(api: ReturnType<typeof githubFixture>['api']) {
  const detail = detailCodec.parse(await readRequest(api, reference));
  const checks = await readChecks(api, { ...reference, commitSha: detail.checksCommit!, cursor: null });
  return { detail, checks };
}

describe('current pull request checks', () => {
  it('reduces the nine contexts from cancelled CI runs to seven current checks across pages', async () => {
    const cancelled = [checkNode(1, 'CI / typecheck, lint, test', 'CANCELLED'), checkNode(2, 'CI / Windows native sandbox', 'CANCELLED')];
    const current = cancelled.map((run, index) => ({
      ...run, id: `CURRENT${index}`, databaseId: index + 8, status: 'QUEUED', conclusion: null,
      checkSuite: { ...run.checkSuite, createdAt: '2026-09-15T04:04:00Z' },
    }));
    const matrix = ['actions', 'javascript-typescript', 'python', 'rust'].map((language, index) => checkNode(index + 3, `Analyze (${language})`));
    const codeql = { ...checkNode(7, 'CodeQL', 'NEUTRAL'), checkSuite: { ...checkNode(7).checkSuite, app: { id: 'APP2', name: 'GitHub Advanced Security' }, workflowRun: null } };
    const fixture = checksFixture([...cancelled, ...matrix, codeql, ...current], 4);
    const { detail, checks } = await readBoth(fixture.api);
    expect(detail).toMatchObject({ checksCommit: 'c'.repeat(40), checksState: 'PENDING', checksProgress: { passed: 5, total: 7 } });
    expect(checks.cursor).toBeNull();
    expect(checks.items).toHaveLength(7);
    expect(checks.items.slice(0, 2).map((check) => check.id)).toEqual(['CURRENT0', 'CURRENT1']);
    expect(checks.items.some((check) => check.conclusion === 'CANCELLED')).toBe(false);
    expect(fixture.request).toHaveBeenCalledTimes(6);

    fixture.failNextPage();
    await expect(readBoth(fixture.api)).rejects.toMatchObject({ code: 'GITHUB_REQUEST_FAILED' });
    await expect(readChecks(fixture.api, { ...reference, commitSha: detail.checksCommit!, cursor: null })).rejects.toMatchObject({ code: 'GITHUB_REQUEST_FAILED' });
  });

  it('keeps distinct sources and current cancellations while replacing reruns and older commit statuses', async () => {
    const original = checkNode(10, 'test', 'FAILURE');
    const suite = original.checkSuite;
    const nodes: CheckNode[] = [
      { ...checkNode(30), status: 'QUEUED', conclusion: null, checkSuite: { ...suite, createdAt: '2026-09-14T01:00:00Z' } }, original,
      checkNode(11, 'test (windows)'),
      { ...checkNode(12), checkSuite: { ...suite, app: { id: 'APP2', name: 'Other CI' } } },
      { ...checkNode(13), checkSuite: { ...suite, workflowRun: { event: 'pull_request', workflow: { id: 'OTHER_WORKFLOW' } } } },
      { ...checkNode(14), checkSuite: { ...suite, workflowRun: { event: 'push', workflow: { id: 'CI' } } } },
      checkNode(15, 'cancelled check', 'CANCELLED'),
      statusNode('status-new', 'test', 'SUCCESS', '2026-09-15T04:01:00Z'), statusNode('status-old', 'test', 'FAILURE'),
    ];
    const { api } = checksFixture(nodes, 3);
    const { detail, checks } = await readBoth(api);
    expect(checks.items.map((check) => check.id)).toEqual(['CR30', 'CR11', 'CR12', 'CR13', 'CR14', 'CR15', 'status-new']);
    expect(detail).toMatchObject({ checksState: 'FAILURE', checksProgress: { passed: 5, total: 7 } });
    expect(checks.items.find((check) => check.id === 'CR15')?.conclusion).toBe('CANCELLED');
  });

  it('counts all pages and legacy states on the merge commit, then falls back to head checks', async () => {
    const runs = Array.from({ length: 200 }, (_, index) => checkNode(index, `job-${index}`,
      index < 180 ? 'SUCCESS' : index < 185 ? 'NEUTRAL' : index < 190 ? 'SKIPPED' : index < 198 ? null : 'FAILURE'));
    const statuses = ['SUCCESS', 'SUCCESS', 'FAILURE', 'ERROR', 'PENDING'].map((state, index) => statusNode(`S${index}`, `deploy-${index}`, state));
    const { api, repository } = checksFixture([...runs, ...statuses]);
    const { detail, checks } = await readBoth(api);
    expect(detail).toMatchObject({ checksCommit: 'c'.repeat(40), checksState: 'FAILURE', checksProgress: { passed: 192, total: 205 } });
    expect(checks.items).toHaveLength(205);

    const pr = repository.pullRequest;
    pr.potentialMergeCommit = null;
    const commit = pr.commits.nodes[0].commit;
    commit.statusCheckRollup = { state: 'SUCCESS', contexts: page([statusNode('H1', 'one'), statusNode('H2', 'two'), statusNode('H3', 'three')]) };
    expect(detailCodec.parse(await readRequest(api, reference))).toMatchObject({ checksCommit: head, checksState: 'SUCCESS', checksProgress: { passed: 3, total: 3 } });
    commit.statusCheckRollup = null;
    expect(detailCodec.parse(await readRequest(api, reference))).toMatchObject({ checksCommit: head, checksState: null, checksProgress: { passed: 0, total: 0 } });
  });
});
