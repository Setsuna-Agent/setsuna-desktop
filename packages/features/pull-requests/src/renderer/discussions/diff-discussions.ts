import type { PullRequestDiscussion } from '../../contracts/index.js';

type DiscussionGroup = { side: 'LEFT' | 'RIGHT'; line: number; discussions: PullRequestDiscussion[] };

/** Old or hidden locations must never be presented as comments on unrelated current code. */
export function partitionDiffDiscussions(discussions: readonly PullRequestDiscussion[], patch: string) {
  const ranges = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu)].map((match) => ({
    LEFT: { start: Number(match[1]), count: Number(match[2] ?? 1) },
    RIGHT: { start: Number(match[3]), count: Number(match[4] ?? 1) },
  }));
  const groups = new Map<string, DiscussionGroup>();
  const detached: PullRequestDiscussion[] = [];
  for (const discussion of discussions) {
    const { line, side } = discussion;
    const visible = !discussion.outdated && line !== null && side !== null && ranges.some((range) => (
      line >= range[side].start && line < range[side].start + range[side].count
    ));
    if (!visible || line === null || side === null) {
      detached.push(discussion);
      continue;
    }
    const key = `${side}:${line}`;
    const group = groups.get(key) ?? { side, line, discussions: [] };
    group.discussions.push(discussion);
    groups.set(key, group);
  }
  return { inline: [...groups.values()], detached };
}
