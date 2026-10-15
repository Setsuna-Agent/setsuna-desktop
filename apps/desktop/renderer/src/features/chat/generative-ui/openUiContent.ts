import { Lexer } from 'marked';

export type OpenUiContentPart =
  | { kind: 'markdown'; key: string; content: string }
  | { kind: 'openui'; key: string; content: string; closed: boolean; offset: number };

/** Only top-level fences opt in. Examples inside quotes, lists or outer fences stay Markdown. */
export function splitOpenUiContent(rawSource: string): OpenUiContentPart[] {
  if (!/^ {0,3}(?:`{3,}|~{3,})openui(?:-lang)?[ \t]*(?:\r?\n|$)/im.test(rawSource)) {
    return [{ kind: 'markdown', key: 'markdown-0', content: rawSource }];
  }
  // Marked normalizes line endings before lexing; offsets must use that same input.
  const source = rawSource.replace(/\r\n?/g, '\n');
  const parts: OpenUiContentPart[] = [];
  let cursor = 0;
  let markdownStart = 0;
  let uiIndex = 0;

  for (const token of Lexer.lex(source, { gfm: true })) {
    const start = source.indexOf(token.raw, cursor);
    if (start < 0) break;
    cursor = start + token.raw.length;
    if (token.type !== 'code' || !/^openui(?:-lang)?$/i.test(token.lang ?? '')) continue;
    const opening = /^( {0,3})(`{3,}|~{3,})openui(?:-lang)?[ \t]*\r?\n/i.exec(token.raw);
    if (!opening) continue;

    parts.push({ kind: 'markdown', key: `markdown-${uiIndex}`, content: source.slice(markdownStart, start) });
    const body = token.raw.slice(opening[0].length);
    const delimiter = opening[2];
    const closing = new RegExp(`(?:^|\\r?\\n) {0,3}${delimiter[0]}{${delimiter.length},}[ \\t]*(?:\\r?\\n)*$`).exec(body);
    parts.push({
      kind: 'openui',
      key: `openui-${uiIndex++}`,
      // ReactMarkdown positions start at the fence delimiter, after any indentation.
      offset: start + opening[1].length,
      // Read the original stream, before Markdown repair can synthesize a closing fence.
      content: closing ? body.slice(0, closing.index) : body,
      closed: closing !== null,
    });
    markdownStart = cursor;
  }

  parts.push({ kind: 'markdown', key: `markdown-${uiIndex}`, content: source.slice(markdownStart) });
  return parts;
}
