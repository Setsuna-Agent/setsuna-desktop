import { splitThinkTaggedText, thinkTagMatches } from '@setsuna-desktop/contracts';

export type LegacyThinkTagStreamChunk = {
  type: 'content' | 'reasoning';
  text: string;
};

/**
 * Decodes providers that still serialize reasoning inside the visible text stream. Only an
 * opening tag at the first non-whitespace position is a protocol envelope; tags in an ordinary
 * answer remain literal content.
 * Once an opening tag is observed, the tagged envelope is buffered until completion. A closing
 * tag can be split across deltas or appear as an example inside the reasoning itself, so publishing
 * an undecided tail would risk placing the visible answer on the private channel (or vice versa).
 */
export class LegacyThinkTagStreamDecoder {
  private legacySource: string | null = null;
  private mode: 'content' | 'detecting' | 'legacy' = 'detecting';
  private pending = '';

  push(delta: string): LegacyThinkTagStreamChunk[] {
    if (!delta) return [];
    if (this.mode === 'content') return [{ type: 'content', text: delta }];
    if (this.mode === 'legacy' && this.legacySource !== null) {
      this.legacySource += delta;
      return [];
    }

    this.pending += delta;
    const envelopeStart = this.pending.search(/\S/u);
    if (envelopeStart < 0) return [];
    const envelope = this.pending.slice(envelopeStart);
    if (isPotentialThinkTag(envelope)) return [];
    const opening = [...thinkTagMatches(envelope)][0];
    if (opening && !opening.closing && opening.index === 0) {
      const chunks: LegacyThinkTagStreamChunk[] = [];
      appendChunk(chunks, 'content', this.pending.slice(0, envelopeStart));
      this.legacySource = envelope;
      this.mode = 'legacy';
      this.pending = '';
      return chunks;
    }

    const content = this.pending;
    this.pending = '';
    this.mode = 'content';
    return [{ type: 'content', text: content }];
  }

  finish(): LegacyThinkTagStreamChunk[] {
    if (this.legacySource !== null) {
      const chunks: LegacyThinkTagStreamChunk[] = [];
      for (const segment of splitThinkTaggedText(this.legacySource)) {
        appendChunk(chunks, segment.type === 'think' ? 'reasoning' : 'content', segment.content);
      }
      this.legacySource = null;
      this.mode = 'content';
      this.pending = '';
      return chunks;
    }
    const content = this.pending;
    this.pending = '';
    this.mode = 'content';
    return content ? [{ type: 'content', text: content }] : [];
  }

  /**
   * Flushes buffered text without interpreting legacy tags after a dedicated reasoning channel
   * proves that the provider's visible content is already authoritative.
   */
  finishAsContent(): LegacyThinkTagStreamChunk[] {
    const content = this.legacySource ?? this.pending;
    this.legacySource = null;
    this.mode = 'content';
    this.pending = '';
    return content ? [{ type: 'content', text: content }] : [];
  }
}

function appendChunk(
  chunks: LegacyThinkTagStreamChunk[],
  type: LegacyThinkTagStreamChunk['type'],
  text: string,
): void {
  if (!text) return;
  const previous = chunks.at(-1);
  if (previous?.type === type) previous.text += text;
  else chunks.push({ type, text });
}

function isPotentialThinkTag(text: string): boolean {
  return isPotentialRawThinkTag(text) || isPotentialEscapedThinkTag(text);
}

function isPotentialRawThinkTag(tail: string): boolean {
  const lower = tail.toLowerCase();
  let cursor = 1;
  if (lower[cursor] === '/') cursor += 1;
  const nameFragment = lower.slice(cursor, Math.min(lower.length, cursor + 5));
  if (!'think'.startsWith(nameFragment)) return false;
  if (nameFragment.length < 5) return true;
  cursor += 5;
  if (cursor === lower.length) return true;
  if (lower[cursor] === '>') return false;
  if (!isWhitespace(lower[cursor])) return false;
  return lower.indexOf('>', cursor + 1) < 0;
}

function isPotentialEscapedThinkTag(tail: string): boolean {
  const lower = tail.toLowerCase();
  if (lower.length < '&lt;'.length) return '&lt;'.startsWith(lower);
  if (!lower.startsWith('&lt;')) return false;
  let cursor = '&lt;'.length;
  if (lower[cursor] === '/') cursor += 1;
  const nameFragment = lower.slice(cursor, Math.min(lower.length, cursor + 5));
  if (!'think'.startsWith(nameFragment)) return false;
  if (nameFragment.length < 5) return true;
  cursor += 5;
  const closingFragment = lower.slice(cursor);
  if ('&gt;'.startsWith(closingFragment)) return closingFragment.length < '&gt;'.length;
  if (!isWhitespace(lower[cursor])) return false;
  const entityStart = lower.indexOf('&', cursor + 1);
  if (entityStart < 0) return true;
  const entityFragment = lower.slice(entityStart);
  return '&gt;'.startsWith(entityFragment) && entityFragment.length < '&gt;'.length;
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && value.trim() === '';
}
