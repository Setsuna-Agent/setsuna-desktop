import { array, choice, integer, object } from './schema.js';

const reaction = object({
  content: choice(['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES']),
  count: integer,
});
export type PullRequestReaction = ReturnType<typeof reaction>;
const list = array(reaction);
export const readReactions = (value: unknown): PullRequestReaction[] => list(value ?? []);
