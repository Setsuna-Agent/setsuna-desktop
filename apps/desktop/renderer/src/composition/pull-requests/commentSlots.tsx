import { TextQuote, X } from 'lucide-react';
import { normalizeQuoteReferences, type PullRequestQuoteReference } from '@setsuna-desktop/feature-pull-requests/renderer';
import type { ComposerSlot } from '../../features/chat/composer/editor/types.js';
import { slotText } from '../../features/chat/composer/editor/composerDocument.js';
import { ChatInlineReference } from '../../features/chat/references/ChatInlineReference.js';

type QuoteSlot = Extract<ComposerSlot, { type: 'tag' }> & { quote: PullRequestQuoteReference };

export function commentSlots(value: string, quotes: PullRequestQuoteReference[], removeLabel: string, disabled: boolean, onRemove: (id: string) => void): ComposerSlot[] {
  const slots: ComposerSlot[] = [];
  let offset = 0;
  for (const quote of normalizeQuoteReferences(value, quotes)) {
    if (quote.start > offset) slots.push({ type: 'text', value: value.slice(offset, quote.start) });
    slots.push({
      type: 'tag', key: quote.id, quote,
      props: {
        value: value.slice(quote.start, quote.end),
        label: <span className="pr-quote-slot">
          <ChatInlineReference icon={<TextQuote size={14} />} label={`@${quote.author} · ${quote.text.replace(/\s+/gu, ' ')}`}
            title={`@${quote.author}\n${quote.text}`} />
          <button type="button" aria-label={removeLabel} title={removeLabel} disabled={disabled}
            onMouseDown={(event) => event.preventDefault()} onClick={() => onRemove(quote.id)}><X size={12} /></button>
        </span>,
      },
    } as QuoteSlot);
    offset = quote.end;
  }
  if (offset < value.length) slots.push({ type: 'text', value: value.slice(offset) });
  return slots;
}

export function commentQuotes(slots: ComposerSlot[]): PullRequestQuoteReference[] {
  const quotes: PullRequestQuoteReference[] = [];
  let start = 0;
  for (const slot of slots) {
    const end = start + slotText(slot).length;
    if (slot.type === 'tag' && 'quote' in slot) quotes.push({ ...(slot as QuoteSlot).quote, start, end });
    start = end;
  }
  return quotes;
}

export function removeCommentQuote(value: string, quotes: PullRequestQuoteReference[], id: string): { value: string; quotes: PullRequestQuoteReference[] } | null {
  const index = quotes.findIndex((quote) => quote.id === id);
  if (index < 0) return null;
  const quote = quotes[index];
  const before = value.slice(0, quote.start);
  const after = value.slice(quote.end);
  let start = before.trim() ? quote.start : 0;
  let end = quote.end;
  // Remove the quote's paragraph separators too, preserving text and other atomic references.
  if (!after.trim()) {
    start = Math.max(before.trimEnd().length, quotes[index - 1]?.end ?? 0);
    end = value.length;
  } else if ((start === 0 || before.endsWith('\n\n')) && after.startsWith('\n\n')) end += 2;
  return {
    value: value.slice(0, start) + value.slice(end),
    quotes: quotes.filter((item) => item.id !== id).map((item) => item.start < start
      ? item : { ...item, start: item.start - (end - start), end: item.end - (end - start) }),
  };
}

export function sameQuotes(left: PullRequestQuoteReference[], right: PullRequestQuoteReference[]): boolean {
  return left.length === right.length && left.every((quote, index) => {
    const other = right[index];
    return quote.id === other.id && quote.start === other.start && quote.end === other.end
      && quote.author === other.author && quote.text === other.text;
  });
}
