export type ThinkTagMatch = {
  closing: boolean;
  end: number;
  index: number;
};

export type ThinkTaggedTextSegment = {
  closed: boolean;
  content: string;
  type: 'markdown' | 'think';
};

type TextRange = {
  end: number;
  start: number;
};

const RAW_TAG_WITHOUT_END = Symbol('raw-tag-without-end');

/**
 * Finds raw and HTML-escaped think tags in linear forward passes.
 *
 * Model output is untrusted and can be large, so this deliberately avoids a
 * backtracking expression whose failed matches rescan the remaining content.
 */
export function* thinkTagMatches(text: string): Generator<ThinkTagMatch> {
  const codeRanges = markdownCodeRanges(text);
  let codeRangeIndex = 0;
  let rawTagsPossible = true;

  for (let index = 0; index < text.length; index += 1) {
    const codeRange = codeRanges[codeRangeIndex];
    if (codeRange && index >= codeRange.start) {
      index = codeRange.end - 1;
      codeRangeIndex += 1;
      continue;
    }

    const code = text.charCodeAt(index);
    if (code === 0x3c && rawTagsPossible) {
      const match = rawThinkTagAt(text, index);
      if (match === RAW_TAG_WITHOUT_END) {
        // No later raw tag can close when the remaining text contains no `>`.
        rawTagsPossible = false;
      } else if (match) {
        yield match;
        index = match.end - 1;
      }
      continue;
    }

    if (code === 0x26) {
      const match = escapedThinkTagAt(text, index);
      if (match) {
        yield match;
        index = match.end - 1;
      }
    }
  }
}

/**
 * Returns only user-visible text, treating an unterminated think block as a hidden tail.
 * This matches the transcript renderer and prevents malformed private reasoning from being
 * mistaken for a usable final answer.
 */
export function visibleTextOutsideThinkTags(text: string): string {
  return splitThinkTaggedText(text)
    .filter((segment) => segment.type === 'markdown')
    .map((segment) => segment.content)
    .join('');
}

/**
 * Splits the deprecated tag-based transcript representation. Markdown code spans, fences, and
 * indented code blocks are excluded before matching because model-authored answers discuss the old
 * protocol as code. Nested blocks use balanced matching, while separate blocks retain the visible
 * text between them. During streaming or after an unterminated opening, that block owns the tail.
 */
export function splitThinkTaggedText(
  text: string,
  options: { legacyStreaming?: boolean } = {},
): ThinkTaggedTextSegment[] {
  const matches = [...thinkTagMatches(text)];
  const segments: ThinkTaggedTextSegment[] = [];
  let cursor = 0;
  let matchIndex = 0;

  const firstOpeningIndex = matches.findIndex((match) => !match.closing);
  if (options.legacyStreaming && firstOpeningIndex >= 0) {
    const opening = matches[firstOpeningIndex];
    return [
      { type: 'markdown', content: text.slice(0, opening.index), closed: true },
      { type: 'think', content: text.slice(opening.end), closed: false },
    ];
  }
  if (firstOpeningIndex >= 0 && hasAmbiguousTagOrder(matches, firstOpeningIndex)) {
    const opening = matches[firstOpeningIndex];
    const closingIndex = findLastClosingIndex(matches, firstOpeningIndex + 1);
    segments.push({ type: 'markdown', content: text.slice(0, opening.index), closed: true });
    if (closingIndex < 0) {
      segments.push({ type: 'think', content: text.slice(opening.end), closed: false });
      return segments;
    }
    const closing = matches[closingIndex];
    segments.push({ type: 'think', content: text.slice(opening.end, closing.index), closed: true });
    if (closing.end < text.length) {
      segments.push({ type: 'markdown', content: text.slice(closing.end), closed: true });
    }
    return segments;
  }

  while (matchIndex < matches.length) {
    let openingIndex = matchIndex;
    while (openingIndex < matches.length && matches[openingIndex]?.closing) openingIndex += 1;
    if (openingIndex >= matches.length) break;
    const opening = matches[openingIndex];
    segments.push({ type: 'markdown', content: text.slice(cursor, opening.index), closed: true });

    const closingIndex = findMatchingClosingIndex(matches, openingIndex + 1);
    if (closingIndex < 0) {
      segments.push({ type: 'think', content: text.slice(opening.end), closed: false });
      cursor = text.length;
      matchIndex = matches.length;
      break;
    }

    const closing = matches[closingIndex];
    segments.push({ type: 'think', content: text.slice(opening.end, closing.index), closed: true });
    cursor = closing.end;
    matchIndex = closingIndex + 1;
  }

  if (cursor < text.length || !segments.length) {
    segments.push({ type: 'markdown', content: text.slice(cursor), closed: true });
  }
  return segments;
}

function findMatchingClosingIndex(matches: ThinkTagMatch[], startIndex: number): number {
  let depth = 1;
  for (let index = startIndex; index < matches.length; index += 1) {
    if (matches[index]?.closing) {
      depth -= 1;
      if (depth === 0) return index;
    } else {
      depth += 1;
    }
  }
  return -1;
}

function findLastClosingIndex(matches: ThinkTagMatch[], startIndex: number): number {
  for (let index = matches.length - 1; index >= startIndex; index -= 1) {
    if (matches[index]?.closing) return index;
  }
  return -1;
}

/**
 * A standalone closing tag proves that the string no longer contains an unambiguous sequence of
 * balanced legacy blocks. In that case the only privacy-safe boundary is the final closing tag.
 */
function hasAmbiguousTagOrder(matches: ThinkTagMatch[], startIndex: number): boolean {
  let depth = 0;
  for (let index = startIndex; index < matches.length; index += 1) {
    if (!matches[index]?.closing) {
      depth += 1;
      continue;
    }
    if (depth === 0) return true;
    depth -= 1;
  }
  return false;
}

/**
 * Returns valid Markdown code ranges. Delimited spans/fences must be closed; an unmatched marker
 * cannot conceal later private reasoning. Indented blocks end at the next nonblank, unindented line.
 */
function markdownCodeRanges(text: string): TextRange[] {
  const blockRanges = mergeOrderedTextRanges(
    markdownFencedCodeRanges(text),
    markdownIndentedCodeRanges(text),
  );
  const ranges: TextRange[] = [];
  let opening: { length: number; start: number } | null = null;
  let blockRangeIndex = 0;
  let lineStart = 0;

  for (let index = 0; index < text.length;) {
    const blockRange = blockRanges[blockRangeIndex];
    if (blockRange && index >= blockRange.start) {
      opening = null;
      ranges.push(blockRange);
      index = blockRange.end;
      blockRangeIndex += 1;
      continue;
    }
    if (text[index] === '\n') {
      lineStart = index + 1;
      index += 1;
      continue;
    }
    if (text[index] !== '`' || isEscapedDelimiter(text, index)) {
      index += 1;
      continue;
    }

    const start = index;
    while (text[index] === '`') index += 1;
    const length = index - start;
    if (
      length >= 3
      && markdownContainerContentStart(text, lineStart, markdownLineEnd(text, lineStart)) === start
    ) {
      opening = null;
      continue;
    }
    if (!opening) {
      opening = { length, start };
    } else if (opening.length === length) {
      ranges.push({ start: opening.start, end: index });
      opening = null;
    }
  }
  return ranges;
}

/**
 * Indented code has no closing delimiter, so only start a block at a document/blank-line boundary.
 * This preserves CommonMark code examples without letting paragraph-continuation indentation hide
 * a malformed legacy privacy boundary.
 */
function markdownIndentedCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let rangeStart: number | null = null;
  let rangeEnd = 0;
  let previousLineBlank = true;

  for (let lineStart = 0; lineStart < text.length;) {
    const lineEnd = markdownLineEnd(text, lineStart);
    const blank = isWhitespaceOnly(text, lineStart, lineEnd);
    const indented = !blank && markdownIndentColumns(text, lineStart, lineEnd) >= 4;

    if (rangeStart !== null) {
      if (indented) {
        rangeEnd = lineEnd;
      } else if (!blank) {
        ranges.push({ start: rangeStart, end: rangeEnd });
        rangeStart = null;
      }
    } else if (indented && previousLineBlank) {
      rangeStart = lineStart;
      rangeEnd = lineEnd;
    }

    previousLineBlank = blank;
    lineStart = lineEnd < text.length ? lineEnd + 1 : text.length;
  }

  if (rangeStart !== null) ranges.push({ start: rangeStart, end: rangeEnd });
  return ranges;
}

function markdownIndentColumns(text: string, lineStart: number, lineEnd: number): number {
  let columns = 0;
  for (let index = lineStart; index < lineEnd; index += 1) {
    if (text[index] === ' ') {
      columns += 1;
    } else if (text[index] === '\t') {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
    if (columns >= 4) return columns;
  }
  return columns;
}

function mergeOrderedTextRanges(left: TextRange[], right: TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length || rightIndex < right.length) {
    const takeLeft = rightIndex >= right.length
      || (leftIndex < left.length && left[leftIndex]!.start <= right[rightIndex]!.start);
    const next = takeLeft ? left[leftIndex++]! : right[rightIndex++]!;
    const previous = merged.at(-1);
    if (previous && next.start <= previous.end) {
      previous.end = Math.max(previous.end, next.end);
    } else {
      merged.push({ ...next });
    }
  }

  return merged;
}

function markdownFencedCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let opening: { length: number; marker: '`' | '~'; start: number } | null = null;

  for (let lineStart = 0; lineStart < text.length;) {
    const lineEnd = markdownLineEnd(text, lineStart);
    const delimiter = markdownFenceDelimiter(text, lineStart, lineEnd);
    if (!opening && delimiter && isFenceOpening(text, delimiter, lineEnd)) {
      opening = {
        length: delimiter.length,
        marker: delimiter.marker,
        start: delimiter.start,
      };
    } else if (
      opening
      && delimiter?.marker === opening.marker
      && delimiter.length >= opening.length
      && isWhitespaceOnly(text, delimiter.end, lineEnd)
    ) {
      ranges.push({ start: opening.start, end: lineEnd });
      opening = null;
    }
    lineStart = lineEnd < text.length ? lineEnd + 1 : text.length;
  }
  return ranges;
}

function markdownFenceDelimiter(
  text: string,
  lineStart: number,
  lineEnd: number,
): { end: number; length: number; marker: '`' | '~'; start: number } | null {
  const start = markdownContainerContentStart(text, lineStart, lineEnd);
  const marker = text[start];
  if (marker !== '`' && marker !== '~') return null;

  let end = start;
  while (end < lineEnd && text[end] === marker) end += 1;
  const length = end - start;
  return length >= 3 ? { end, length, marker, start } : null;
}

function isFenceOpening(
  text: string,
  delimiter: { end: number; marker: '`' | '~' },
  lineEnd: number,
): boolean {
  return delimiter.marker === '~' || !text.slice(delimiter.end, lineEnd).includes('`');
}

/** Returns the first content byte after valid block quote/list container prefixes. */
function markdownContainerContentStart(text: string, lineStart: number, lineEnd: number): number {
  let cursor = lineStart;
  while (cursor < lineEnd) {
    let contentStart = cursor;
    while (contentStart < lineEnd && text[contentStart] === ' ' && contentStart - cursor < 3) {
      contentStart += 1;
    }

    if (text[contentStart] === '>') {
      cursor = contentStart + 1;
      if (text[cursor] === ' ' || text[cursor] === '\t') cursor += 1;
      continue;
    }

    const listContentStart = markdownListContentStart(text, contentStart, lineEnd);
    if (listContentStart !== null) {
      cursor = listContentStart;
      continue;
    }
    return contentStart;
  }
  return cursor;
}

function markdownListContentStart(text: string, start: number, lineEnd: number): number | null {
  let markerEnd = start;
  const marker = text[markerEnd];
  if (marker === '-' || marker === '+' || marker === '*') {
    markerEnd += 1;
  } else {
    while (markerEnd < lineEnd && markerEnd - start < 9 && isAsciiDigit(text[markerEnd])) {
      markerEnd += 1;
    }
    if (markerEnd === start || (text[markerEnd] !== '.' && text[markerEnd] !== ')')) return null;
    markerEnd += 1;
  }

  let contentStart = markerEnd;
  while (contentStart < lineEnd && text[contentStart] === ' ' && contentStart - markerEnd < 5) {
    contentStart += 1;
  }
  const padding = contentStart - markerEnd;
  return padding >= 1 && padding <= 4 ? contentStart : null;
}

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function isWhitespaceOnly(text: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (text[index] !== ' ' && text[index] !== '\t' && text[index] !== '\r') return false;
  }
  return true;
}

function markdownLineEnd(text: string, lineStart: number): number {
  const lineFeed = text.indexOf('\n', lineStart);
  return lineFeed < 0 ? text.length : lineFeed;
}

function isEscapedDelimiter(text: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function rawThinkTagAt(
  text: string,
  index: number,
): ThinkTagMatch | typeof RAW_TAG_WITHOUT_END | null {
  let cursor = index + 1;
  const closing = text[cursor] === '/';
  if (closing) cursor += 1;
  if (!startsWithAsciiIgnoreCase(text, cursor, 'think')) return null;
  cursor += 'think'.length;

  if (text[cursor] === '>') return { closing, end: cursor + 1, index };
  if (!isWhitespace(text[cursor])) return null;

  const tagEnd = text.indexOf('>', cursor + 1);
  return tagEnd < 0
    ? RAW_TAG_WITHOUT_END
    : { closing, end: tagEnd + 1, index };
}

function escapedThinkTagAt(text: string, index: number): ThinkTagMatch | null {
  if (!startsWithAsciiIgnoreCase(text, index, '&lt;')) return null;
  let cursor = index + '&lt;'.length;
  const closing = text[cursor] === '/';
  if (closing) cursor += 1;
  if (!startsWithAsciiIgnoreCase(text, cursor, 'think')) return null;
  cursor += 'think'.length;

  if (startsWithAsciiIgnoreCase(text, cursor, '&gt;')) {
    return { closing, end: cursor + '&gt;'.length, index };
  }
  if (!isWhitespace(text[cursor])) return null;

  // The escaped form historically accepts attributes without another entity.
  const tagEnd = text.indexOf('&', cursor + 1);
  return tagEnd >= 0 && startsWithAsciiIgnoreCase(text, tagEnd, '&gt;')
    ? { closing, end: tagEnd + '&gt;'.length, index }
    : null;
}

function startsWithAsciiIgnoreCase(text: string, index: number, expected: string): boolean {
  if (index < 0 || index + expected.length > text.length) return false;
  for (let offset = 0; offset < expected.length; offset += 1) {
    const actualCode = asciiLowerCode(text.charCodeAt(index + offset));
    const expectedCode = asciiLowerCode(expected.charCodeAt(offset));
    if (actualCode !== expectedCode) return false;
  }
  return true;
}

function asciiLowerCode(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && value.trim() === '';
}
