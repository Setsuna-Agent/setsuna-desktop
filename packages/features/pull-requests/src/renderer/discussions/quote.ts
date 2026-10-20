export type PullRequestQuote = { author: string; text: string };
export type PullRequestQuoteReference = PullRequestQuote & { id: string; start: number; end: number };

export function serializeQuote(quote: PullRequestQuote): string {
  return `@${quote.author}\n${quote.text.split(/\r?\n/u).map((line) => `> ${line}`).join('\n')}`;
}

/** Quote the rendered passage, never Markdown's raw HTML or hidden comment markers. */
export function quoteText(element: HTMLElement | null): string {
  if (!element) return '';
  const selection = element.ownerDocument.getSelection();
  const selected = selection && element.contains(selection.anchorNode) && element.contains(selection.focusNode)
    ? selection.toString().trim() : '';
  return selected || (element.innerText ?? element.textContent ?? '').trim();
}

/** Ranges are the editor's atomic slots; stale ranges must not conceal unrelated draft text. */
export function normalizeQuoteReferences(body: string, value: unknown): PullRequestQuoteReference[] {
  if (!Array.isArray(value)) return [];
  const quotes: PullRequestQuoteReference[] = [];
  const ids = new Set<string>();
  let end = 0;
  for (const quote of value) {
    if (!quote || typeof quote !== 'object' || typeof quote.id !== 'string' || ids.has(quote.id)
      || typeof quote.author !== 'string' || typeof quote.text !== 'string' || !quote.text.trim()
      || !Number.isInteger(quote.start) || !Number.isInteger(quote.end)
      || quote.start < end || quote.end <= quote.start || quote.end > body.length
      || body.slice(quote.start, quote.end) !== serializeQuote(quote)) continue;
    quotes.push({ id: quote.id, author: quote.author, text: quote.text, start: quote.start, end: quote.end });
    ids.add(quote.id);
    end = quote.end;
  }
  return quotes;
}
