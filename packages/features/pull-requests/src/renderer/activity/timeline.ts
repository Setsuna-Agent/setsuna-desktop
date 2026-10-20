import type { PullRequestActivityEvent, PullRequestDetail, PullRequestDiscussion } from '../../contracts/index.js';

export type TimelineItem = { kind: 'event'; event: PullRequestActivityEvent } | { kind: 'discussion'; discussion: PullRequestDiscussion };

/** Creation is a PR field, not a GitHub timeline node; add it once using its original timestamp. */
export function pullRequestTimeline(detail: PullRequestDetail, events: PullRequestActivityEvent[], discussions: PullRequestDiscussion[]): TimelineItem[] {
  const opened: PullRequestActivityEvent = { id: `${detail.id}_opened`, kind: 'opened', actor: detail.author, createdAt: detail.createdAt, commit: null };
  const items: TimelineItem[] = [
    ...[opened, ...events].map((event) => ({ kind: 'event' as const, event })),
    ...discussions.map((discussion) => ({ kind: 'discussion' as const, discussion })),
  ];
  const time = (item: TimelineItem) => item.kind === 'event' ? item.event.createdAt : item.discussion.comments[0]?.createdAt ?? '';
  return items.sort((a, b) => time(a).localeCompare(time(b)));
}
