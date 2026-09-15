import { Button } from '@setsuna-desktop/renderer-ui';
import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PullRequestReference } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { usePrText, usePullRequestsHost } from './context.js';
import { readDraft, updateDraft, useCommentDraft } from './useCommentDraft.js';
import { useCommentPublication } from './useCommentPublication.js';

export type QuoteRequest = { id: number; text: string };
export function CommentComposer({ client, reference, account, threadId = null, quote, disabled, onPublished }: {
  client: PullRequestsClient; reference: PullRequestReference; account: string; threadId?: string | null;
  quote?: QuoteRequest | null; disabled?: boolean; onPublished(): void;
}) {
  const t = usePrText();
  const { CommentInput } = usePullRequestsHost();
  const key = `${account}/${reference.repository}/${reference.number}/${threadId ?? 'conversation'}`;
  const { draft, pending } = useCommentDraft(key);
  const [focusRequest, setFocusRequest] = useState<number>();
  const submit = useCommentPublication({ client, reference, account, threadId, draftKey: key, disabled, onPublished });
  const quoteId = useRef<number | null>(null);
  useEffect(() => {
    if (!quote || quote.id === quoteId.current) return;
    quoteId.current = quote.id;
    const current = readDraft(key);
    updateDraft(key, `${current.body}${current.body ? '\n\n' : ''}${quote.text}\n\n`.slice(0, 65_000));
    setFocusRequest(quote.id);
  }, [quote, key]);
  const label = threadId ? t('reply') : t('comment');
  const submitLabel = threadId ? t('reply') : t('publishComment');
  return <section className="pr-composer" aria-label={label}>
    <CommentInput
      label={label} placeholder={threadId ? t('replyPlaceholder') : t('commentPlaceholder')}
      value={draft.body} disabled={Boolean(disabled || pending)} maxLength={65_000}
      focusRequest={focusRequest} onChange={(body) => updateDraft(key, body)} onSubmit={() => void submit()}
      footer={<div className="pr-composer__footer">
        <span>{t('markdownSupported')}</span>
        <Button className="chat-prompt__submit" variant="primary" aria-label={submitLabel} title={submitLabel} loading={pending} disabled={disabled || !draft.body.trim()} onClick={() => void submit()}>
          {pending ? null : <ArrowUp size={16} />}
        </Button>
      </div>}
    />
  </section>;
}
