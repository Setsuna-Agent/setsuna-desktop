import { IconButton } from '@setsuna-desktop/renderer-ui';
import { ExternalLink, Reply, TextQuote } from 'lucide-react';
import { useRef } from 'react';
import type { PullRequestComment, PullRequestDetail, PullRequestReference } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';
import { usePrText, usePullRequestsHost } from '../context.js';
import { GitHubAvatar } from '../GitHubIdentity.js';
import { Timestamp } from '../status.js';
import { PullRequestReactions } from './PullRequestReactions.js';
import { quoteText } from './quote.js';

/** Relative links and images in PR Markdown resolve against the head commit, like GitHub. */
export function markdownBaseUrl(detail: Pick<PullRequestDetail, 'headRepository' | 'repository' | 'headSha'>): string {
  return `https://github.com/${detail.headRepository ?? detail.repository}/blob/${detail.headSha}/`;
}

/** PR descriptions and comments share the same header, Markdown and reaction controls. */
export function PullRequestCommentItem({ client, reference, account, onUpdated, comment, baseUrl, emptyBody, onReply, onQuote }: {
  comment: Omit<PullRequestComment, 'databaseId'>; baseUrl: string; emptyBody?: string;
  client: PullRequestsClient; reference: PullRequestReference; account: string; onUpdated(): void;
  onReply?(): void; onQuote?(text: string): void;
}) {
  const t = usePrText();
  const { Markdown, openExternal } = usePullRequestsHost();
  const body = useRef<HTMLDivElement>(null);
  const quote = () => onQuote?.(quoteText(body.current));
  return <article className="pr-comment" id={`pr-comment-${comment.id}`}>
    <header className="pr-comment__header">
      <GitHubAvatar login={comment.author.login} avatarUrl={comment.author.avatarUrl} />
      <span className="pr-comment__byline">
        <strong className="pr-comment__author" title={comment.author.login}>{comment.author.login}</strong>
        <Timestamp value={comment.createdAt} />
      </span>
      <span className="pr-comment__actions">
        <IconButton size="small" label={t('permalink')} onClick={() => void openExternal(comment.url)}><ExternalLink size={14} /></IconButton>
      </span>
    </header>
    <div className="pr-comment__body">
      {comment.body ? <div className="pr-markdown" ref={body}><Markdown content={comment.body} baseUrl={baseUrl} /></div>
        : emptyBody ? <p className="pr-muted">{emptyBody}</p> : null}
      <PullRequestReactions key={`${account}/${comment.id}`} client={client} reference={reference} subjectId={comment.id}
        account={account} reactions={comment.reactions} canReact={comment.canReact} onUpdated={onUpdated}>
        {onReply ? <IconButton size="small" label={t('reply')} onClick={onReply}><Reply size={14} /></IconButton> : null}
        {onQuote && comment.body ? <IconButton size="small" label={t('quoteReply')} onMouseDown={(event) => event.preventDefault()} onClick={quote}><TextQuote size={14} /></IconButton> : null}
      </PullRequestReactions>
    </div>
  </article>;
}
