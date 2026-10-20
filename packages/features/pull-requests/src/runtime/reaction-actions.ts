import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { PullRequestReactionInput, PullRequestReference } from '../contracts/index.js';
import { assertAccount } from './account.js';
import { readDiscussions } from './discussions.js';
import { GitHubApi } from './github-api.js';
import { reactionFields, reactions, type ReactionNode } from './reactions.js';

type Identity = { number: number; repository: { nameWithOwner: string } };
type Subject = {
  id: string; __typename: string; viewerCanReact: boolean; reactionGroups: ReactionNode[];
  number?: number; repository?: { nameWithOwner: string }; pullRequest?: Identity | null;
};
const identityFields = 'number repository { nameWithOwner }';
const matches = (input: PullRequestReference, identity: Identity | null | undefined) =>
  identity?.number === input.number && identity.repository.nameWithOwner.toLowerCase() === input.repository.toLowerCase();

export class PullRequestReactionActions {
  private readonly active = new Set<string>();
  constructor(private readonly api: GitHubApi) {}

  async set(input: PullRequestReactionInput, signal?: AbortSignal) {
    const key = `${input.expectedAccount.toLowerCase()}:${input.subjectId}`;
    if (this.active.has(key)) throw new FeatureOperationFailure({ code: 'PR_ACTION_BLOCKED', message: 'A reaction is already being updated.', retryable: false });
    this.active.add(key);
    try {
      await assertAccount(this.api, input.expectedAccount, signal);
      const { node } = await this.api.graphql<{ node: Subject | null }>(`
        query($id: ID!) { node(id: $id) {
          __typename id ... on Reactable { ${reactionFields} }
          ... on PullRequest { ${identityFields} }
          ... on IssueComment { pullRequest { ${identityFields} } }
          ... on PullRequestReview { pullRequest { ${identityFields} } }
          ... on PullRequestReviewComment { pullRequest { ${identityFields} } }
          ... on CommitComment { repository { nameWithOwner } }
        } }`, { id: input.subjectId }, signal);
      if (!node || node.id !== input.subjectId || !await this.belongsToRequest(input, node, signal)) {
        throw new FeatureOperationFailure({ code: 'PR_NOT_FOUND', message: 'This reaction target does not belong to the selected pull request.', retryable: false });
      }
      if (!node.viewerCanReact) throw new FeatureOperationFailure({ code: 'PR_ACTION_BLOCKED', message: 'This account cannot react to this content.', retryable: false });
      // Send a desired state, not a toggle: retries after a lost response cannot undo the first write.
      if (Boolean(node.reactionGroups.find((group) => group.content === input.content)?.viewerHasReacted) === (input.action === 'add')) {
        return { reactions: reactions(node.reactionGroups) };
      }
      await assertAccount(this.api, input.expectedAccount, signal);
      const operation = input.action === 'add' ? 'addReaction' : 'removeReaction';
      const inputType = input.action === 'add' ? 'AddReactionInput' : 'RemoveReactionInput';
      const result = await this.api.graphql<Record<string, { subject: Subject | null }>>(`
        mutation($input: ${inputType}!) { ${operation}(input: $input) { subject { id ${reactionFields} } } }
      `, { input: { subjectId: input.subjectId, content: input.content } }, signal);
      const subject = result[operation]?.subject;
      if (!subject || subject.id !== input.subjectId) throw new FeatureOperationFailure({ code: 'PR_WRITE_UNCERTAIN', message: 'GitHub did not confirm the reaction. Refresh before trying again.', retryable: false });
      return { reactions: reactions(subject.reactionGroups) };
    } finally { this.active.delete(key); }
  }

  private async belongsToRequest(input: PullRequestReference, node: Subject, signal?: AbortSignal): Promise<boolean> {
    if (node.__typename === 'PullRequest') return matches(input, node as Subject & Identity);
    if (['IssueComment', 'PullRequestReview', 'PullRequestReviewComment'].includes(node.__typename)) return matches(input, node.pullRequest);
    if (node.__typename !== 'CommitComment' || node.repository?.nameWithOwner.toLowerCase() !== input.repository.toLowerCase()) return false;
    // Commit comments are repository-scoped; verify they occur in this PR's actual timeline.
    let cursor: string | null = null;
    do {
      const page = await readDiscussions(this.api, { ...input, kind: 'commits', cursor }, signal);
      if (page.items.some((item) => item.comments.some((comment) => comment.id === node.id))) return true;
      cursor = page.cursor;
    } while (cursor);
    return false;
  }
}
