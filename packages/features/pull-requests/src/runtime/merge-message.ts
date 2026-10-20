import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { PullRequestMergeMessage, PullRequestMergeMessageInput } from '../contracts/index.js';
import { assertAccountLogin } from './account.js';
import { type GitHubApi, repoVariables } from './github-api.js';

/** GitHub generates the defaults using repository settings and the PR's commits. */
export async function readMergeMessage(api: GitHubApi, input: PullRequestMergeMessageInput, signal?: AbortSignal): Promise<PullRequestMergeMessage> {
  const result = await api.graphql<{
    viewer: { login: string };
    repository: { pullRequest: {
      headRefOid: string; baseRefName: string; title: string; body: string;
    } | null } | null;
  }>(`
    query($owner: String!, $name: String!, $number: Int!, $method: PullRequestMergeMethod!) {
      viewer { login }
      repository(owner: $owner, name: $name) { pullRequest(number: $number) {
        headRefOid baseRefName
        title: viewerMergeHeadlineText(mergeType: $method)
        body: viewerMergeBodyText(mergeType: $method)
      } }
    }`, { ...repoVariables(input.repository), number: input.number, method: input.method }, signal);
  assertAccountLogin(result.viewer.login, input.expectedAccount);
  const pr = result.repository?.pullRequest;
  if (!pr || pr.headRefOid !== input.headSha || pr.baseRefName !== input.baseBranch) {
    throw new FeatureOperationFailure({ code: 'PR_CHANGED', message: 'The pull request changed. Refresh it before preparing the merge.', retryable: false });
  }
  return { title: pr.title, body: pr.body };
}
