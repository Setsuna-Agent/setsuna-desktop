import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { PublishPullRequestComment, PullRequestAction, PullRequestComment } from '../contracts/index.js';
import { comment, commentFields, readThread, type CommentNode } from './discussions.js';
import { GitHubApi, GitHubApiFailure, nextCursor, repoPath, repoVariables, requestChanged, type Page, pageFields } from './github-api.js';
import { readRequest } from './pull-requests.js';

function blocked(message: string): never {
  throw new FeatureOperationFailure({ code: 'PR_ACTION_BLOCKED', message, retryable: false });
}
export function commentNotSentFailure(error: unknown): FeatureOperationFailure {
  return new FeatureOperationFailure({
    code: 'PR_COMMENT_NOT_SENT', message: error instanceof Error ? error.message : 'The comment could not be sent.', retryable: false,
  });
}
function uncertain(error: unknown): boolean {
  return error instanceof FeatureOperationFailure && error.code === 'PR_WRITE_UNCERTAIN';
}
export class PullRequestActions {
  private readonly comments = new Map<string, { fingerprint: string; promise: Promise<PullRequestComment> }>();
  private readonly active = new Set<string>();
  constructor(private readonly api: GitHubApi) {}

  async publish(input: PublishPullRequestComment, signal?: AbortSignal): Promise<PullRequestComment> {
    try {
      await this.assertAccount(input.expectedAccount, signal);
      const key = `${input.expectedAccount.toLowerCase()}:${input.requestId}`;
      const fingerprint = JSON.stringify([input.repository, input.number, input.threadId, input.body]);
      const existing = this.comments.get(key);
      if (existing && existing.fingerprint !== fingerprint) throw new Error('This comment request already belongs to another draft.');
      if (input.reconcileOnly) {
        // A lookup must not declare an in-flight write absent. A confirmed response is
        // also stronger evidence than a list that may lag behind the mutation.
        if (existing) {
          try { return await existing.promise; } catch { /* Query GitHub after the write has settled. */ }
        }
        const found = await this.findPublished(input, `<!-- setsuna-pr-comment:${input.requestId} -->`, signal);
        if (found) return comment(found);
        this.comments.delete(key);
        throw new FeatureOperationFailure({ code: 'PR_COMMENT_NOT_FOUND', message: 'The complete comment list does not contain this comment.', retryable: false });
      }
      if (existing) return await existing.promise;
      const promise = this.publishOnce(input, signal).catch((error: unknown) => {
        // Keep ambiguous writes for deduplication, but let an unsent draft be retried.
        if (!uncertain(error) && this.comments.get(key)?.promise === promise) this.comments.delete(key);
        throw error;
      });
      this.comments.set(key, { fingerprint, promise });
      if (this.comments.size > 500) this.comments.delete(this.comments.keys().next().value!);
      return await promise;
    } catch (error) {
      if (input.reconcileOnly || uncertain(error) || (error instanceof FeatureOperationFailure && error.code === 'PR_ACCOUNT_CHANGED')) throw error;
      throw commentNotSentFailure(error);
    }
  }

  private async publishOnce(input: PublishPullRequestComment, signal?: AbortSignal): Promise<PullRequestComment> {
    const pr = await readRequest(this.api, input, signal);
    if (!pr.canComment) blocked('Comments are unavailable for this pull request.');
    const marker = `<!-- setsuna-pr-comment:${input.requestId} -->`;
    // The marker survives a lost response/restart. It is hidden in Markdown and removed from projections.
    const existing = await this.findPublished(input, marker, signal);
    if (existing) return comment(existing);
    const body = `${input.body}\n${marker}`;
    // Pagination may take time; check again at the write boundary after all reads.
    await this.assertAccount(input.expectedAccount, signal);
    signal?.throwIfAborted();
    try {
      if (input.threadId) {
        const result = await this.api.graphql<{ addPullRequestReviewThreadReply: { comment: CommentNode } }>(`
          mutation($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { comment { ${commentFields} } } }
        `, { input: { pullRequestReviewThreadId: input.threadId, body, clientMutationId: input.requestId } }, signal);
        return comment(result.addPullRequestReviewThreadReply.comment);
      }
      const result = await this.api.graphql<{ addComment: { commentEdge: { node: CommentNode } } }>(`
        mutation($input: AddCommentInput!) { addComment(input: $input) { commentEdge { node { ${commentFields} } } } }
      `, { input: { subjectId: pr.id, body, clientMutationId: input.requestId } }, signal);
      return comment(result.addComment.commentEdge.node);
    } catch (error) {
      if (error instanceof GitHubApiFailure && error.requestRejected) throw error;
      // Never automatically retry a write after a connection/response failure.
      throw new FeatureOperationFailure({
        code: 'PR_WRITE_UNCERTAIN',
        message: error instanceof Error ? error.message : 'GitHub did not confirm the comment.', retryable: false,
      });
    }
  }

  private async findPublished(input: PublishPullRequestComment, marker: string, signal?: AbortSignal): Promise<CommentNode | undefined> {
    let cursor: string | null = null;
    do {
      let page: Page<CommentNode>;
      if (input.threadId) {
        const thread = await readThread(this.api, { ...input, threadId: input.threadId, cursor }, signal);
        if (!input.reconcileOnly && !thread.viewerCanReply) blocked('Replies are unavailable for this discussion.');
        page = thread.comments;
      } else {
        const result = await this.api.graphql<{ repository: { pullRequest: { comments: Page<CommentNode> } } }>(`
          query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
            repository(owner: $owner, name: $name) { pullRequest(number: $number) { comments(first: 100, after: $cursor) { ${pageFields} nodes { ${commentFields} } } } }
          }`, { ...repoVariables(input.repository), number: input.number, cursor }, signal);
        page = result.repository.pullRequest.comments;
      }
      const found = page.nodes.find((item) => item.body.includes(marker));
      if (found) return found;
      cursor = nextCursor(page);
    } while (cursor);
    return undefined;
  }

  private async assertAccount(expectedAccount: string, signal?: AbortSignal): Promise<void> {
    const { value: viewer } = await this.api.request<{ login: string }>('/user', { signal });
    if (viewer.login?.toLowerCase() !== expectedAccount.toLowerCase()) {
      throw new FeatureOperationFailure({ code: 'PR_ACCOUNT_CHANGED', message: 'The GitHub account changed. Confirm the current account before trying again.', retryable: false });
    }
  }

  async act(input: PullRequestAction, signal?: AbortSignal): Promise<{ state: 'merged' | 'auto-merge-enabled' | 'auto-merge-disabled' | 'queued' }> {
    const key = `${input.repository}:${input.number}`;
    if (this.active.has(key)) blocked('A pull request action is already in progress.');
    this.active.add(key);
    try {
      await this.assertAccount(input.expectedAccount, signal);
      const pr = await readRequest(this.api, input, signal);
      if (pr.headSha !== input.headSha || pr.baseBranch !== input.baseBranch) requestChanged();
      if (pr.state !== 'OPEN') blocked('This pull request is no longer open.');
      await this.assertAccount(input.expectedAccount, signal);
      if (input.action === 'disable-auto-merge') {
        if (!pr.canDisableAutoMerge) blocked('Auto-merge cannot be disabled by this account.');
        await this.api.graphql('mutation($input: DisablePullRequestAutoMergeInput!) { disablePullRequestAutoMerge(input: $input) { pullRequest { id } } }', { input: { pullRequestId: pr.id } }, signal);
        return { state: 'auto-merge-disabled' };
      }
      if (pr.draft) blocked('Mark this pull request ready for review before merging.');
      // The queue chooses its own merge method from the branch rules.
      if (input.action !== 'enqueue' && !pr.allowedMethods.includes(input.method)) blocked('This merge method is disabled in the repository.');
      if (input.action === 'enable-auto-merge') {
        if (!pr.canEnableAutoMerge) blocked('Auto-merge is unavailable for this pull request or account.');
        await this.api.graphql('mutation($input: EnablePullRequestAutoMergeInput!) { enablePullRequestAutoMerge(input: $input) { pullRequest { id } } }', { input: { pullRequestId: pr.id, mergeMethod: input.method } }, signal);
        return { state: 'auto-merge-enabled' };
      }
      if (!pr.canMerge) blocked('This account cannot merge into the target repository.');
      if (pr.queueState) blocked('This pull request is already in the merge queue.');
      if (input.action === 'enqueue') {
        if (!pr.queueRequired) blocked('This branch has no merge queue.');
        await this.api.graphql('mutation($input: EnqueuePullRequestInput!) { enqueuePullRequest(input: $input) { mergeQueueEntry { id } } }', { input: { pullRequestId: pr.id, expectedHeadOid: input.headSha } }, signal);
        return { state: 'queued' };
      }
      if (pr.queueRequired) blocked('This branch requires the merge queue.');
      if (pr.mergeable !== 'MERGEABLE' || !['CLEAN', 'UNSTABLE', 'HAS_HOOKS'].includes(pr.mergeState)) blocked(`Merge requirements are not satisfied (${pr.mergeState}).`);
      const { value } = await this.api.request<{ merged: boolean; message: string }>(`${repoPath(input.repository)}/pulls/${input.number}/merge`, {
        method: 'PUT', body: { sha: input.headSha, merge_method: input.method.toLowerCase() }, signal,
      });
      if (!value.merged) blocked(value.message);
      return { state: 'merged' };
    } finally { this.active.delete(key); }
  }
}
