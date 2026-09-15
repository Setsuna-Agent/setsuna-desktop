import type { FeatureOperationDescriptor, FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import * as operations from '../contracts/operations.js';

export function createPullRequestsClient(transport: FeatureOperationTransport) {
  const bind = <I, O>(operation: FeatureOperationDescriptor<I, O>) => (input: I, signal?: AbortSignal) => transport.call(operation, input, { signal });
  return {
    connection: bind(operations.readPullRequestConnection), repositories: bind(operations.readPullRequestRepositories),
    installation: bind(operations.readGitHubCliInstallation), install: bind(operations.installGitHubCli),
    list: bind(operations.listPullRequests), detail: bind(operations.readPullRequest),
    discussions: bind(operations.readPullRequestDiscussions), replies: bind(operations.readPullRequestReplies),
    checks: bind(operations.readPullRequestChecks), files: bind(operations.readPullRequestFiles), patch: bind(operations.readPullRequestPatch),
    publish: bind(operations.publishPullRequestComment), act: bind(operations.performPullRequestAction),
  };
}
export type PullRequestsClient = ReturnType<typeof createPullRequestsClient>;

export const isAccountChangedError = (cause: unknown): boolean => Boolean(
  cause && typeof cause === 'object' && 'code' in cause && cause.code === 'PR_ACCOUNT_CHANGED',
);
