import { defineFeature } from '@setsuna-desktop/feature-core/definition';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type { RuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { codec, object } from './schema.js';
import * as models from './models.js';

export const pullRequestsFeature = defineFeature('pull-requests');
const empty = codec(object({}));
const errors = Object.freeze({
  GITHUB_REQUEST_FAILED: { status: 502 }, GITHUB_RATE_LIMITED: { status: 429 },
  GITHUB_ACCESS_DENIED: { status: 403 }, PR_NOT_FOUND: { status: 404 },
  GITHUB_CLI_NOT_FOUND: { status: 503 },
  PR_CHANGED: { status: 409 }, PR_ACCOUNT_CHANGED: { status: 409 }, PR_ACTION_BLOCKED: { status: 409 },
  PR_COMMENT_NOT_SENT: { status: 502 }, PR_COMMENT_NOT_FOUND: { status: 404 }, PR_WRITE_UNCERTAIN: { status: 409 }, PR_GIT_FAILED: { status: 502 },
});
function operation<I, O>(name: string, input: RuntimeCodec<I>, output: RuntimeCodec<O>, write = false) {
  return defineFeatureOperation({
    id: `pull-requests.${name}`, method: 'POST', path: `/v1/features/pull-requests/${name.replaceAll('.', '/')}`,
    input, output, errors, idempotency: write ? 'non-idempotent' : 'safe',
  });
}
export const readPullRequestConnection = operation('connection.read', empty, models.connectionCodec);
export const readGitHubCliInstallation = operation('cli-installation.read', empty, models.cliInstallationCodec);
export const installGitHubCli = operation('cli-installation.start', empty, models.cliInstallationCodec, true);
export const readPullRequestRepositories = operation('repositories.list', empty, models.repositoriesCodec);
export const listPullRequests = operation('requests.list', models.listInputCodec, models.listResultCodec);
export const readPullRequest = operation('requests.read', models.referenceCodec, models.detailCodec);
export const readPullRequestDiscussions = operation('discussions.list', models.discussionInputCodec, models.discussionResultCodec);
export const readPullRequestReplies = operation('replies.list', models.repliesInputCodec, models.repliesResultCodec);
export const readPullRequestChecks = operation('checks.list', models.checksInputCodec, models.checksResultCodec);
export const readPullRequestFiles = operation('files.list', models.filesInputCodec, models.filesResultCodec);
export const readPullRequestPatch = operation('files.patch', models.patchInputCodec, models.patchResultCodec);
export const publishPullRequestComment = operation('comments.publish', models.commentInputCodec, models.commentResultCodec, true);
export const performPullRequestAction = operation('requests.act', models.actionInputCodec, models.actionResultCodec, true);
