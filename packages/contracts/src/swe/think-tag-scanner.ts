export type ThinkTagMatch = {
  closing: boolean;
  end: number;
  index: number;
};

const RAW_TAG_WITHOUT_END = Symbol('raw-tag-without-end');

/**
 * Finds raw and HTML-escaped think tags in one forward pass.
 *
 * Model output is untrusted and can be large, so this deliberately avoids a
 * backtracking expression whose failed matches rescan the remaining content.
 */
export function* thinkTagMatches(text: string): Generator<ThinkTagMatch> {
  let rawTagsPossible = true;

  for (let index = 0; index < text.length; index += 1) {
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
