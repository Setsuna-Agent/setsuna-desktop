import { readReactions } from '../contracts/reactions.js';

export const reactionFields = 'reactionGroups { content users { totalCount } }';
export type ReactionNode = { content: string; users: { totalCount: number } };
export function reactions(groups: readonly ReactionNode[] = []) {
  return readReactions(groups.filter((group) => group.users.totalCount > 0).map((group) => ({
    content: group.content, count: group.users.totalCount,
  })));
}
