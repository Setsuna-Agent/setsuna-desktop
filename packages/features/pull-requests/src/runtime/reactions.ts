import { readReactions } from '../contracts/reactions.js';

export const reactionFields = 'viewerCanReact reactionGroups { content viewerHasReacted users: reactors { totalCount } }';
export type ReactionNode = { content: string; viewerHasReacted?: boolean; users: { totalCount: number } };
export function reactions(groups: readonly ReactionNode[] = []) {
  return readReactions(groups.filter((group) => group.users.totalCount > 0).map((group) => ({
    content: group.content, count: group.users.totalCount, viewerHasReacted: group.viewerHasReacted ?? false,
  })));
}
