// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { normalizeQuoteReferences, quoteText, serializeQuote } from '../../../src/renderer/discussions/quote.js';
import { appendDraftQuote, readDraft, saveDraft, settleDraft, updateDraft } from '../../../src/renderer/useCommentDraft.js';

it('quotes rendered text without HTML and scopes selected passages to their source', () => {
  const body = document.createElement('div');
  body.innerHTML = '<details><summary>Review</summary><p>Fix <code>clearAnimationFlags</code></p></details><!-- tips_end --><sub>Help</sub>';
  document.body.append(body);
  expect(quoteText(body)).not.toContain('<');
  expect(quoteText(body)).not.toContain('tips_end');
  const code = body.querySelector('code')!.firstChild!;
  const range = document.createRange();
  range.selectNodeContents(code);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  expect(quoteText(body)).toBe('clearAnimationFlags');
  const other = document.createElement('p');
  other.textContent = 'Another comment';
  expect(quoteText(other)).toBe('Another comment');
  selection.removeAllRanges();
  body.remove();
});

it('restores quote slots with a durable draft and rejects stale ranges', () => {
  const key = `restore-${crypto.randomUUID()}`;
  const quote = { author: 'alice', text: 'Selected passage' };
  const content = serializeQuote(quote);
  const body = `${content}\n\nMy reply`;
  const reference = { ...quote, id: crypto.randomUUID(), start: 0, end: content.length };
  localStorage.setItem(`setsuna-pr-draft:v1:${key}`, JSON.stringify({ body, quotes: [reference], requestId: crypto.randomUUID(), uncertain: false }));
  expect(readDraft(key)).toMatchObject({ body, quotes: [reference] });
  expect(normalizeQuoteReferences(body, [reference, reference])).toEqual([reference]);
  expect(normalizeQuoteReferences(`Changed ${body}`, [reference])).toEqual([]);
});

it('reuses paragraph separators when adding quotes without changing existing quoted text or ranges', () => {
  const key = `spacing-${crypto.randomUUID()}`;
  updateDraft(key, '\n\n\n\n');
  const first = { author: 'alice', text: 'First passage  ' };
  const second = { author: 'bob', text: 'Second passage' };
  expect(appendDraftQuote(key, first)).toBe(true);
  const initial = readDraft(key);
  expect(initial.body).toBe(`${serializeQuote(first)}\n\n`);
  expect(appendDraftQuote(key, second)).toBe(true);
  const next = readDraft(key);
  expect(next.body).toBe(`${serializeQuote(first)}\n\n${serializeQuote(second)}\n\n`);
  expect(next.quotes?.[0]).toEqual(initial.quotes?.[0]);
  expect(normalizeQuoteReferences(next.body, next.quotes)).toEqual(next.quotes);
});

it('keeps edited quote slots when reconciling an earlier uncertain send, and never truncates a quote at the length limit', () => {
  const key = `recover-${crypto.randomUUID()}`;
  updateDraft(key, 'Original');
  expect(appendDraftQuote(key, { author: 'alice', text: 'First quote' })).toBe(true);
  const sent = readDraft(key);
  saveDraft(key, { ...sent, submittedBody: sent.body, uncertain: true });
  expect(appendDraftQuote(key, { author: 'bob', text: 'Second quote' })).toBe(true);
  expect(readDraft(key).submittedBody).toBe(sent.body);
  settleDraft(key, sent.requestId, true);
  expect(readDraft(key).quotes?.map((quote) => quote.author)).toEqual(['alice', 'bob']);
  expect(readDraft(key).body).toContain('Second quote');
  updateDraft(key, 'x'.repeat(64_990));
  const limited = readDraft(key);
  expect(appendDraftQuote(key, { author: 'alice', text: 'Too long for this draft' })).toBe(false);
  expect(readDraft(key)).toBe(limited);
});
