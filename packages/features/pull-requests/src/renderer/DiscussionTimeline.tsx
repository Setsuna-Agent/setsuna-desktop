import { markdownBaseUrl, PullRequestCommentItem } from './discussions/PullRequestCommentItem.js';
import { Button, DetailSection } from '@setsuna-desktop/renderer-ui';
import { MessageSquare, GitCommitHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { PullRequestComment, PullRequestDetail, PullRequestDiscussion } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { CommentComposer, type QuoteRequest } from './CommentComposer.js';
import { usePrText } from './context.js';
import { stateLabel } from './status.js';
import { PullRequestSkeleton } from './loading/PullRequestSkeleton.js';
import type { DiscussionsState } from './useDiscussions.js';
import { PullRequestDescription } from './discussions/PullRequestDescription.js';
import { usePullRequestActivity } from './activity/usePullRequestActivity.js';
import { pullRequestTimeline } from './activity/timeline.js';
import { PullRequestActivityRow } from './activity/PullRequestActivityRow.js';

export function DiscussionTimeline({ client, detail, account, discussions, revision, onPublished, onDiff, checks }: {
  client: PullRequestsClient; detail: PullRequestDetail; account: string; discussions: DiscussionsState; revision: number;
  onPublished(): void; onDiff(discussion: PullRequestDiscussion): void; checks?: ReactNode;
}) {
  const t = usePrText();
  const [quote, setQuote] = useState<QuoteRequest | null>(null);
  const activity = usePullRequestActivity(client, detail, revision);
  const requestQuote = (comment: Pick<PullRequestComment, 'author'>, text: string) =>
    setQuote((previous) => ({ id: (previous?.id ?? 0) + 1, quote: { author: comment.author.login, text } }));
  const items = pullRequestTimeline(detail, activity.items, discussions.items);
  return <section className="pr-timeline" aria-label={t('discussion')}>
    <section className="pr-activity" aria-label={t('activity')}>
      {discussions.errors.map((error, index) => <p key={index} className="sd-control-error" role="alert">{error}</p>)}
      {activity.error ? <div className="pr-error" role="alert">{activity.error}<Button size="small" onClick={activity.retry}>{t('retry')}</Button></div> : null}
      <ol className="pr-timeline__stack">
        <li className="pr-timeline__entry">
          <PullRequestDescription client={client} detail={detail} account={account} onUpdated={onPublished} onQuote={(text) => requestQuote(detail, text)} />
        </li>
        {items.map((item) => <li className="pr-timeline__entry" key={item.kind === 'event' ? `event:${item.event.id}` : `discussion:${item.discussion.id}`}>
          {item.kind === 'event' ? <PullRequestActivityRow event={item.event} />
            : <DiscussionCard discussion={item.discussion} client={client} detail={detail} account={account}
              onPublished={onPublished} onDiff={onDiff} onQuote={requestQuote} moreReplies={() => void discussions.moreReplies(item.discussion)} repliesPending={discussions.repliesPending === item.discussion.id} />}
        </li>)}
        {(discussions.pending && !discussions.items.length) || (activity.pending && !activity.items.length)
          ? <li className="pr-timeline__entry"><div className="pr-card"><PullRequestSkeleton kind="discussion" label={t('loading')} /></div></li> : null}
      </ol>
      {discussions.hasMore || activity.hasMore ? <Button className="pr-timeline__more" disabled={discussions.pending || activity.pending}
        onClick={() => { void discussions.more(); void activity.more(); }}>{t('moreActivity')}</Button> : null}
    </section>
    {checks}
    <CommentComposer client={client} reference={detail} account={account} disabled={!detail.canComment} quote={quote} onPublished={onPublished} />
  </section>;
}

export function DiscussionCard({ discussion, client, detail, account, onPublished, onDiff, onQuote, moreReplies, repliesPending = false, inline = false }: {
  discussion: PullRequestDiscussion; client: PullRequestsClient; detail: PullRequestDetail; account: string;
  onPublished(): void; onDiff(discussion: PullRequestDiscussion): void; onQuote?(comment: PullRequestComment, text: string): void;
  moreReplies?(): void; repliesPending?: boolean; inline?: boolean;
}) {
  const t = usePrText();
  const [replying, setReplying] = useState(false);
  const [quote, setQuote] = useState<QuoteRequest | null>(null);
  const thread = discussion.kind === 'thread';
  const baseUrl = markdownBaseUrl(detail);
  const canReply = detail.canComment && discussion.canReply;
  const comments = discussion.comments.map((comment) => <PullRequestCommentItem key={comment.id} client={client} reference={detail} account={account}
    onUpdated={onPublished} comment={comment} baseUrl={baseUrl} onReply={canReply && thread ? () => setReplying(true) : undefined}
    onQuote={!canReply || (!thread && !onQuote) ? undefined : (text) => {
      if (!thread) { onQuote?.(comment, text); return; }
      setReplying(true);
      setQuote((previous) => ({ id: (previous?.id ?? 0) + 1, quote: { author: comment.author.login, text } }));
    }} />);
  // A top-level comment has no location or review state, so a collapsible "Comment" header would only add noise.
  if (discussion.kind === 'comment') return <section className="pr-card pr-discussion" aria-label={t('comment')}>{comments}</section>;
  const title = thread ? `${discussion.path}${discussion.line ? `:${discussion.line}` : ''}`
    : discussion.kind === 'review' ? stateLabel(discussion.state ?? 'COMMENTED', t)
      : `${t('commitComment')} ${discussion.commitSha?.slice(0, 7)}`;
  return <DetailSection title={title} icon={discussion.kind === 'commit' ? <GitCommitHorizontal size={15} /> : <MessageSquare size={15} />} count={discussion.resolved ? t('resolved') : discussion.outdated ? t('outdated') : discussion.comments.length} defaultExpanded={!discussion.resolved} className="pr-discussion">
    {thread && !inline ? <div className="pr-discussion__context">
      {discussion.diffHunk ? <pre className="pr-discussion__snippet">{discussion.diffHunk}</pre> : null}
      <div className="pr-discussion__location"><Button size="small" variant="ghost" onClick={() => onDiff(discussion)}>{discussion.outdated ? t('viewCurrentFile') : t('viewDiff')}</Button>{discussion.outdated ? <span>{t('outdatedLocation')}</span> : null}</div>
    </div> : null}
    {comments}
    {repliesPending ? <PullRequestSkeleton kind="discussion" label={t('loading')} /> : null}
    {discussion.replyCursor && moreReplies ? <Button size="small" disabled={repliesPending} onClick={moreReplies}>{t('moreReplies')}</Button> : null}
    {replying ? <CommentComposer client={client} reference={detail} account={account} threadId={discussion.id} quote={quote} disabled={!detail.canComment || !discussion.canReply} onPublished={onPublished} /> : null}
  </DetailSection>;
}
