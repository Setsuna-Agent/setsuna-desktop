import type { PullRequestActivityEvent, PullRequestActivityInput, PullRequestActivityResult } from '../contracts/index.js';
import { actor, actorFields, GitHubApi, nextCursor, pageFields, repoVariables, type Actor, type Page } from './github-api.js';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';

// GitHub emits distinct events for merge, squash and rebase auto-merge settings.
const eventTypes = {
  ClosedEvent: ['CLOSED_EVENT', 'closed'],
  ReopenedEvent: ['REOPENED_EVENT', 'reopened'],
  MergedEvent: ['MERGED_EVENT', 'merged'],
  ReadyForReviewEvent: ['READY_FOR_REVIEW_EVENT', 'ready-for-review'],
  ConvertToDraftEvent: ['CONVERT_TO_DRAFT_EVENT', 'draft'],
  AutoMergeEnabledEvent: ['AUTO_MERGE_ENABLED_EVENT', 'auto-merge-enabled'],
  AutoSquashEnabledEvent: ['AUTO_SQUASH_ENABLED_EVENT', 'auto-squash-enabled'],
  AutoRebaseEnabledEvent: ['AUTO_REBASE_ENABLED_EVENT', 'auto-rebase-enabled'],
  AutoMergeDisabledEvent: ['AUTO_MERGE_DISABLED_EVENT', 'auto-merge-disabled'],
  AddedToMergeQueueEvent: ['ADDED_TO_MERGE_QUEUE_EVENT', 'queued'],
  RemovedFromMergeQueueEvent: ['REMOVED_FROM_MERGE_QUEUE_EVENT', 'dequeued'],
} as const;
type EventNode = { __typename: keyof typeof eventTypes; id: string; createdAt: string; actor: Actor };
type CommitNode = {
  __typename: 'PullRequestCommit'; id: string;
  commit: { oid: string; messageHeadline: string; url: string; committedDate: string; author: { user: Actor } | null };
};
type ActivityNode = EventNode | CommitNode;
const itemTypes = [...Object.values(eventTypes).map(([type]) => type), 'PULL_REQUEST_COMMIT'].join(', ');
const fragments = Object.keys(eventTypes).map((type) => `... on ${type} { id createdAt actor { ${actorFields} } }`).join('\n');

export async function readActivity(api: GitHubApi, input: PullRequestActivityInput, signal?: AbortSignal): Promise<PullRequestActivityResult> {
  const data = await api.graphql<{ repository: { pullRequest: { timelineItems: Page<ActivityNode> } | null } | null }>(`
    query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) {
        timelineItems(first: 50, after: $cursor, itemTypes: [${itemTypes}]) {
          ${pageFields} nodes { __typename ${fragments}
            ... on PullRequestCommit { id commit { oid messageHeadline url committedDate author { user { ${actorFields} } } } }
          }
        }
      } }
    }`, { ...repoVariables(input.repository), number: input.number, cursor: input.cursor }, signal);
  const page = data.repository?.pullRequest?.timelineItems;
  if (!page) throw new FeatureOperationFailure({ code: 'PR_NOT_FOUND', message: 'Pull request not found.', retryable: false });
  const items: PullRequestActivityEvent[] = page.nodes.filter(Boolean).map((node) => {
    if (node.__typename === 'PullRequestCommit') {
      return {
        id: node.id, kind: 'commit', createdAt: node.commit.committedDate,
        actor: node.commit.author?.user ? actor(node.commit.author.user) : null,
        commit: { sha: node.commit.oid, message: node.commit.messageHeadline, url: node.commit.url },
      };
    }
    return { id: node.id, kind: eventTypes[node.__typename][1], createdAt: node.createdAt, actor: node.actor ? actor(node.actor) : null, commit: null };
  });
  return { items, cursor: nextCursor(page) };
}
