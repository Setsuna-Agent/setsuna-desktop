import { useState, type ReactNode } from 'react';
import { Button, IconButton, Popover } from '@setsuna-desktop/renderer-ui';
import { SmilePlus } from 'lucide-react';
import { reactionContents, type PullRequestReaction, type PullRequestReference } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';
import { usePrText } from '../context.js';
import { usePullRequestReaction } from './usePullRequestReaction.js';

const symbols: Record<PullRequestReaction['content'], string> = {
  THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉',
  CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀',
};

export function PullRequestReactions({ client, reference, subjectId, account, reactions, canReact, onUpdated, children }: {
  client: PullRequestsClient; reference: PullRequestReference; subjectId: string; account: string;
  reactions: readonly PullRequestReaction[]; canReact: boolean; onUpdated(): void; children?: ReactNode;
}) {
  const t = usePrText();
  const [open, setOpen] = useState(false);
  const { items, pending, toggle } = usePullRequestReaction({ client, reference, subjectId, account, reactions, onUpdated });
  const label = (content: PullRequestReaction['content']) => t(`reaction.${content}`);
  const choose = (content: PullRequestReaction['content']) => { setOpen(false); void toggle(content); };
  return <div className="pr-reactions">
    {items.map((reaction) => <Button key={reaction.content} size="small" variant="ghost" className="pr-reactions__count"
      title={label(reaction.content)} aria-label={`${label(reaction.content)} ${reaction.count}`} aria-pressed={reaction.viewerHasReacted}
      disabled={!canReact || pending} onClick={() => choose(reaction.content)}>
      <span aria-hidden="true">{symbols[reaction.content]}</span>{reaction.count}
    </Button>)}
    {canReact ? <Popover placement="topLeft" contentLabel={t('addReaction')} open={open} onOpenChange={setOpen} className="pr-reaction-picker"
      content={<div className="pr-reaction-picker__grid">{reactionContents.map((content) =>
        <IconButton key={content} size="small" label={label(content)} disabled={pending}
          aria-pressed={Boolean(items.find((item) => item.content === content)?.viewerHasReacted)} onClick={() => choose(content)}>{symbols[content]}</IconButton>,
      )}</div>}>
      <IconButton size="small" label={t('addReaction')} disabled={pending} loading={pending}>{pending ? null : <SmilePlus size={14} />}</IconButton>
    </Popover> : null}
    {children}
  </div>;
}
