import { Button, DetailSection } from '@setsuna-desktop/renderer-ui';
import { MessageSquare, GitCommitHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { PullRequestComment, PullRequestDetail, PullRequestDiscussion } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { CommentComposer, type QuoteRequest } from './CommentComposer.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { Loading, stateLabel, Timestamp } from './status.js';
import type { DiscussionsState } from './useDiscussions.js';

export function DiscussionTimeline({ client, detail, account, discussions, onPublished, onDiff }: {
  client: PullRequestsClient; detail: PullRequestDetail; account: string; discussions: DiscussionsState;
  onPublished(): void; onDiff(discussion: PullRequestDiscussion): void;
}) {
  const t = usePrText();
  const [quote, setQuote] = useState<QuoteRequest | null>(null);
  const quoteComment = (comment: PullRequestComment) => setQuote({ id: Date.now(), text: `@${comment.author.login}\n${comment.body.split('\n').map((line) => `> ${line}`).join('\n')}` });
  return <section className="pr-timeline" aria-label={t('discussion')}>
    {discussions.items.length ? <h3>{t('discussion')}</h3> : null}
    {discussions.errors.map((error, index) => <p key={index} className="sd-control-error" role="alert">{error}</p>)}
    {discussions.items.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} client={client} detail={detail} account={account} onPublished={onPublished} onDiff={onDiff} onQuote={quoteComment} moreReplies={() => void discussions.moreReplies(discussion)} repliesPending={discussions.repliesPending === discussion.id} />)}
    {discussions.pending ? <Loading /> : null}
    {discussions.hasMore ? <Button disabled={discussions.pending} onClick={() => void discussions.more()}>{t('moreDiscussions')}</Button> : null}
    <CommentComposer client={client} reference={detail} account={account} disabled={!detail.canComment} quote={quote} onPublished={onPublished} />
  </section>;
}

export function DiscussionCard({ discussion, client, detail, account, onPublished, onDiff, onQuote, moreReplies, repliesPending = false }: {
  discussion: PullRequestDiscussion; client: PullRequestsClient; detail: PullRequestDetail; account: string;
  onPublished(): void; onDiff(discussion: PullRequestDiscussion): void; onQuote?(comment: PullRequestComment): void;
  moreReplies?(): void; repliesPending?: boolean;
}) {
  const t = usePrText();
  const { Markdown, openExternal } = usePullRequestsHost();
  const [replying, setReplying] = useState(false);
  const thread = discussion.kind === 'thread';
  const title = thread ? `${discussion.path}${discussion.line ? `:${discussion.line}` : ''}`
    : discussion.kind === 'review' ? stateLabel(discussion.state ?? 'COMMENTED', t)
      : discussion.kind === 'commit' ? `${t('commitComment')} ${discussion.commitSha?.slice(0, 7)}` : t('comment');
  return <DetailSection title={title} icon={discussion.kind === 'commit' ? <GitCommitHorizontal size={15} /> : <MessageSquare size={15} />} count={discussion.resolved ? t('resolved') : discussion.outdated ? t('outdated') : discussion.comments.length} defaultExpanded={!discussion.resolved} className="pr-discussion">
    {thread && discussion.diffHunk ? <pre className="pr-discussion__snippet">{discussion.diffHunk}</pre> : null}
    {thread ? <div className="pr-discussion__location"><Button size="small" variant="ghost" onClick={() => onDiff(discussion)}>{discussion.outdated ? t('viewCurrentFile') : t('viewDiff')}</Button>{discussion.outdated ? <span>{t('outdatedLocation')}</span> : null}</div> : null}
    {discussion.comments.map((comment) => <article className="pr-comment" key={comment.id} id={`pr-comment-${comment.id}`}>
      <header>
        {comment.author.avatarUrl ? <img src={comment.author.avatarUrl} alt="" width={22} height={22} loading="lazy" referrerPolicy="no-referrer" /> : null}
        <strong>{comment.author.login}</strong><Timestamp value={comment.createdAt} />
        <Button size="small" variant="ghost" onClick={() => void openExternal(comment.url)}>{t('permalink')}</Button>
      </header>
      {comment.body ? <div className="pr-markdown"><Markdown content={comment.body} baseUrl={`https://github.com/${detail.headRepository ?? detail.repository}/blob/${detail.headSha}/`} /></div> : null}
      {detail.canComment && discussion.canReply ? <Button size="small" variant="ghost" onClick={() => thread ? setReplying(true) : onQuote?.(comment)}>{thread ? t('reply') : t('quoteReply')}</Button> : null}
    </article>)}
    {discussion.replyCursor && moreReplies ? <Button size="small" loading={repliesPending} onClick={moreReplies}>{t('moreReplies')}</Button> : null}
    {replying ? <CommentComposer client={client} reference={detail} account={account} threadId={discussion.id} disabled={!detail.canComment || !discussion.canReply} onPublished={onPublished} /> : null}
  </DetailSection>;
}
