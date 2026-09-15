import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { PullRequestComment, PullRequestDiscussion, PullRequestDiscussionInput, PullRequestDiscussionResult, PullRequestReference, PullRequestRepliesInput } from '../contracts/index.js';
import { actor, actorFields, GitHubApi, nextCursor, pageFields, repoVariables, type Actor, type Page } from './github-api.js';

export const commentFields = `id databaseId body createdAt url author { ${actorFields} }`;
export type CommentNode = { id: string; databaseId: number | null; body: string; createdAt: string; url: string; author: Actor };
export function comment(node: CommentNode): PullRequestComment {
  return { ...node, author: actor(node.author), body: node.body.replace(/\n?<!-- setsuna-pr-comment:[a-zA-Z0-9_-]+ -->/gu, '') };
}
const blankThread = {
  state: null, resolved: false, outdated: false, canReply: true, path: null, line: null, side: null,
  diffHunk: null, commitSha: null, replyCursor: null,
} as const;
type ReviewNode = CommentNode & { state: string };
type ThreadNode = {
  id: string; isResolved: boolean; isOutdated: boolean; viewerCanReply: boolean; path: string;
  line: number | null; originalLine: number | null; diffSide: 'LEFT' | 'RIGHT';
  comments: Page<CommentNode & { diffHunk: string; commit: { oid: string } | null }>;
};
type CommitThreadNode = { id: string; commit: { oid: string }; comments: Page<CommentNode> };

export async function readDiscussions(api: GitHubApi, input: PullRequestDiscussionInput, signal?: AbortSignal): Promise<PullRequestDiscussionResult> {
  const { kind } = input;
  const field = kind === 'threads' ? 'reviewThreads' : kind === 'commits' ? 'timelineItems' : kind;
  const fragment = kind === 'threads'
    ? `id isResolved isOutdated viewerCanReply path line originalLine diffSide comments(first: 100) { ${pageFields} nodes { ${commentFields} diffHunk commit { oid } } }`
    : kind === 'commits'
      ? `... on PullRequestCommitCommentThread { id commit { oid } comments(first: 100) { ${pageFields} nodes { ${commentFields} } } }`
      : `${commentFields} ${kind === 'reviews' ? 'state' : ''}`;
  const data = await api.graphql<{ repository: { pullRequest: Record<string, Page<CommentNode | ReviewNode | ThreadNode | CommitThreadNode>> } }>(`
    query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) {
        ${field}(first: 50, after: $cursor${kind === 'commits' ? ', itemTypes: [PULL_REQUEST_COMMIT_COMMENT_THREAD]' : ''}) { ${pageFields} nodes { ${fragment} } }
      } }
    }`, { ...repoVariables(input.repository), number: input.number, cursor: input.cursor }, signal);
  const page = data.repository.pullRequest[field];
  const items: PullRequestDiscussion[] = [];
  for (const node of page.nodes) {
    if (kind === 'threads') {
      const thread = node as ThreadNode;
      items.push({
        ...blankThread, id: thread.id, kind: 'thread', resolved: thread.isResolved, outdated: thread.isOutdated,
        canReply: thread.viewerCanReply, path: thread.path, line: thread.line ?? thread.originalLine, side: thread.diffSide,
        diffHunk: thread.comments.nodes[0]?.diffHunk ?? null, commitSha: thread.comments.nodes[0]?.commit?.oid ?? null,
        comments: thread.comments.nodes.map(comment), replyCursor: nextCursor(thread.comments),
      });
    } else if (kind === 'commits') {
      const thread = node as CommitThreadNode;
      // Commit comments have their own discussion URL; keep all pages in the PR timeline.
      const comments = [...thread.comments.nodes];
      let cursor = nextCursor(thread.comments);
      while (cursor) {
        const next = await api.graphql<{ node: { comments: Page<CommentNode> } }>(`
          query($id: ID!, $cursor: String) { node(id: $id) { ... on PullRequestCommitCommentThread { comments(first: 100, after: $cursor) { ${pageFields} nodes { ${commentFields} } } } } }
        `, { id: thread.id, cursor }, signal);
        comments.push(...next.node.comments.nodes);
        cursor = nextCursor(next.node.comments);
      }
      items.push({ ...blankThread, id: thread.id, kind: 'commit', commitSha: thread.commit.oid, comments: comments.map(comment) });
    } else {
      const item = node as ReviewNode;
      items.push({ ...blankThread, id: item.id, kind: kind === 'reviews' ? 'review' : 'comment', state: kind === 'reviews' ? item.state : null, comments: [comment(item)] });
    }
  }
  return { items, cursor: nextCursor(page) };
}

type ThreadIdentity = { id: string; viewerCanReply: boolean; pullRequest: { number: number; repository: { nameWithOwner: string } } };
export function assertThread(reference: PullRequestReference, thread: ThreadIdentity | null): asserts thread is ThreadIdentity {
  if (!thread || thread.pullRequest.number !== reference.number
    || thread.pullRequest.repository.nameWithOwner.toLowerCase() !== reference.repository.toLowerCase()) {
    throw new FeatureOperationFailure({ code: 'PR_NOT_FOUND', message: 'This discussion does not belong to the selected pull request.', retryable: false });
  }
}
export async function readThread(api: GitHubApi, input: PullRequestRepliesInput, signal?: AbortSignal) {
  const { node } = await api.graphql<{ node: ThreadIdentity & { comments: Page<CommentNode> } }>(`
    query($id: ID!, $cursor: String) { node(id: $id) { ... on PullRequestReviewThread {
      id viewerCanReply pullRequest { number repository { nameWithOwner } }
      comments(first: 100, after: $cursor) { ${pageFields} nodes { ${commentFields} } }
    } } }
  `, { id: input.threadId, cursor: input.cursor }, signal);
  assertThread(input, node);
  return node;
}
