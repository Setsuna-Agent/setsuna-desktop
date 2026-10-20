import type { PullRequestDetail } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';
import { usePrText } from '../context.js';
import { markdownBaseUrl, PullRequestCommentItem } from './PullRequestCommentItem.js';

export function PullRequestDescription({ client, detail, account, onUpdated, onQuote }: {
  client: PullRequestsClient; detail: PullRequestDetail; account: string; onUpdated(): void; onQuote(text: string): void;
}) {
  const t = usePrText();
  return <section className="pr-card" aria-label={t('description')}>
    <PullRequestCommentItem client={client} reference={detail} account={account} comment={detail}
      baseUrl={markdownBaseUrl(detail)} emptyBody={t('noDescription')} onUpdated={onUpdated}
      onQuote={detail.canComment ? onQuote : undefined} />
  </section>;
}
