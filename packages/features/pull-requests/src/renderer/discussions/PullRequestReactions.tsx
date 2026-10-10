import type { PullRequestReaction } from '../../contracts/reactions.js';

const symbols: Record<PullRequestReaction['content'], string> = {
  THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉',
  CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀',
};

export function PullRequestReactions({ reactions }: { reactions: readonly PullRequestReaction[] }) {
  if (!reactions.length) return null;
  return <div className="pr-reactions">{reactions.map((reaction) => (
    <span key={reaction.content}>{symbols[reaction.content]} {reaction.count}</span>
  ))}</div>;
}
