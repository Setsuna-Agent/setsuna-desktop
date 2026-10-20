import { array, boolean, choice, codec, integer, nodeId, object, positiveInteger, repositoryId, text } from './schema.js';

export const reactionContents = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'] as const;
const reaction = object({
  content: choice(reactionContents), count: integer, viewerHasReacted: boolean,
});
export type PullRequestReaction = ReturnType<typeof reaction>;
const list = array(reaction);
export const readReactions = (value: unknown): PullRequestReaction[] => list(value ?? []);
export const reactionInputCodec = codec(object({
  repository: repositoryId, number: positiveInteger, subjectId: nodeId,
  expectedAccount: text(200, /^\S+$/u), content: choice(reactionContents), action: choice(['add', 'remove']),
}));
export type PullRequestReactionInput = ReturnType<typeof reactionInputCodec.parse>;
export const reactionResultCodec = codec(object({ reactions: readReactions }));
