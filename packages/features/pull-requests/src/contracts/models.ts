import { array, boolean, choice, codec, cursor, httpsUrl, integer, nodeId, nullable, object, oid, positiveInteger, repositoryId, text, filePath } from './schema.js';

export const actor = object({ login: text(200), avatarUrl: nullable(httpsUrl) });
export const reference = object({ repository: repositoryId, number: positiveInteger });
export const referenceCodec = codec(reference);
export type PullRequestReference = ReturnType<typeof reference>;
export const mergeMethod = choice(['MERGE', 'SQUASH', 'REBASE']);
export type MergeMethod = ReturnType<typeof mergeMethod>;
export const filterState = choice(['open', 'draft', 'merged', 'closed', 'all']);
export type PullRequestFilterState = ReturnType<typeof filterState>;
export const filters = object({ state: filterState, author: text(100), search: text(200) });
export type PullRequestFilters = ReturnType<typeof filters>;

const repository = object({
  id: repositoryId, fullName: repositoryId,
  projects: array(object({ id: text(200), name: text(200) })),
  remotes: array(text(200)),
});
export type PullRequestRepository = ReturnType<typeof repository>;
export const repositoriesCodec = codec(object({
  repositories: array(repository),
  issues: array(object({ project: text(200), message: text() })),
}));
export type PullRequestRepositories = ReturnType<typeof repositoriesCodec.parse>;

export const summaryShape = {
  id: nodeId, repository: repositoryId, number: positiveInteger, title: text(), url: httpsUrl,
  author: actor, state: choice(['OPEN', 'CLOSED', 'MERGED']), draft: boolean,
  updatedAt: text(50), headSha: oid, checksState: nullable(text(80)),
};
export const summary = object(summaryShape);
export type PullRequestSummary = ReturnType<typeof summary>;
export const listInputCodec = codec(object({ repository: repositoryId, cursor, filters }));
export type PullRequestListInput = ReturnType<typeof listInputCodec.parse>;
export const listResultCodec = codec(object({ items: array(summary), cursor }));
export type PullRequestListResult = ReturnType<typeof listResultCodec.parse>;

export const detailCodec = codec(object({
  ...summaryShape, body: text(1_000_000), createdAt: text(50),
  baseBranch: text(1024), headBranch: text(1024), baseSha: oid, headRepository: nullable(repositoryId),
  additions: integer, deletions: integer, fileCount: integer, commentCount: integer,
  mergeable: text(80), mergeState: text(80), reviewDecision: nullable(text(80)),
  canComment: boolean, canMerge: boolean, canEnableAutoMerge: boolean, canDisableAutoMerge: boolean,
  allowedMethods: array(mergeMethod), autoMerge: nullable(object({ method: mergeMethod, author: actor })),
  queueRequired: boolean, queueState: nullable(text(80)),
  reviewers: array(object({ name: text(200), avatarUrl: nullable(httpsUrl), state: text(80) })),
  checksCommit: nullable(oid), checksProgress: nullable(object({ passed: integer, total: integer })),
}));
export type PullRequestDetail = ReturnType<typeof detailCodec.parse>;

const comment = object({
  id: nodeId, databaseId: nullable(positiveInteger), author: actor,
  body: text(1_000_000), createdAt: text(50), url: httpsUrl,
});
export type PullRequestComment = ReturnType<typeof comment>;
export const discussion = object({
  id: nodeId, kind: choice(['comment', 'review', 'thread', 'commit']),
  state: nullable(text(80)), resolved: boolean, outdated: boolean, canReply: boolean,
  path: nullable(filePath), line: nullable(positiveInteger), side: nullable(choice(['LEFT', 'RIGHT'])),
  diffHunk: nullable(text(1_000_000)), commitSha: nullable(oid),
  comments: array(comment), replyCursor: cursor,
});
export type PullRequestDiscussion = ReturnType<typeof discussion>;
export const discussionInputCodec = codec(object({
  ...{ repository: repositoryId, number: positiveInteger },
  kind: choice(['comments', 'reviews', 'threads', 'commits']), cursor,
}));
export type PullRequestDiscussionInput = ReturnType<typeof discussionInputCodec.parse>;
export const discussionResultCodec = codec(object({ items: array(discussion), cursor }));
export type PullRequestDiscussionResult = ReturnType<typeof discussionResultCodec.parse>;
export const repliesInputCodec = codec(object({ repository: repositoryId, number: positiveInteger, threadId: nodeId, cursor }));
export type PullRequestRepliesInput = ReturnType<typeof repliesInputCodec.parse>;
export const repliesResultCodec = codec(object({ comments: array(comment), cursor }));

export const check = object({
  id: nodeId, name: text(), source: text(200), state: text(80), conclusion: nullable(text(80)),
  required: boolean, url: nullable(httpsUrl), startedAt: nullable(text(50)), completedAt: nullable(text(50)),
  summary: text(1_000_000),
});
export type PullRequestCheck = ReturnType<typeof check>;
export const checksInputCodec = codec(object({ repository: repositoryId, number: positiveInteger, commitSha: oid, cursor }));
export type PullRequestChecksInput = ReturnType<typeof checksInputCodec.parse>;
export const checksResultCodec = codec(object({ items: array(check), cursor }));

const file = object({ path: filePath, previousPath: nullable(filePath), status: text(80), additions: integer, deletions: integer });
export type PullRequestFile = ReturnType<typeof file>;
export const filesInputCodec = codec(object({ repository: repositoryId, number: positiveInteger, headSha: oid, baseSha: oid, page: positiveInteger }));
export type PullRequestFilesInput = ReturnType<typeof filesInputCodec.parse>;
export const filesResultCodec = codec(object({ files: array(file), nextPage: nullable(positiveInteger), total: integer, reset: boolean }));
export const patchInputCodec = codec(object({ repository: repositoryId, number: positiveInteger, headSha: oid, baseSha: oid, path: filePath }));
export type PullRequestPatchInput = ReturnType<typeof patchInputCodec.parse>;
export const patchResultCodec = codec(object({ patch: nullable(text(32_000_000)), kind: choice(['text', 'binary', 'empty']), }));
export type PullRequestPatch = ReturnType<typeof patchResultCodec.parse>;

export const commentInputCodec = codec(object({
  repository: repositoryId, number: positiveInteger,
  expectedAccount: text(200, /^\S+$/u),
  body: text(65_000, /\S/u), threadId: nullable(nodeId), requestId: text(100, /^[a-zA-Z0-9_-]{16,100}$/u),
  reconcileOnly: boolean,
}));
export type PublishPullRequestComment = ReturnType<typeof commentInputCodec.parse>;
export const actionInputCodec = codec(object({
  repository: repositoryId, number: positiveInteger, headSha: oid, baseBranch: text(1024, /\S/u),
  expectedAccount: text(200, /^\S+$/u),
  action: choice(['merge', 'enable-auto-merge', 'disable-auto-merge', 'enqueue']), method: mergeMethod,
}));
export type PullRequestAction = ReturnType<typeof actionInputCodec.parse>;
export const actionResultCodec = codec(object({ state: choice(['merged', 'auto-merge-enabled', 'auto-merge-disabled', 'queued']) }));
export const commentResultCodec = codec(comment);

export const connectionCodec = codec(object({
  state: choice(['connected', 'not-installed', 'signed-out', 'error']), login: nullable(text(200)), avatarUrl: nullable(httpsUrl), error: nullable(text()), loginCommand: text(8192),
}));
export type PullRequestConnection = ReturnType<typeof connectionCodec.parse>;

export const cliInstallationCodec = codec(object({
  phase: choice(['idle', 'checking', 'downloading', 'verifying', 'installing', 'complete', 'error']),
  receivedBytes: integer, totalBytes: nullable(integer), error: nullable(text()),
}));
export type GitHubCliInstallation = ReturnType<typeof cliInstallationCodec.parse>;
