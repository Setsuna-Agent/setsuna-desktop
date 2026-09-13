export type RuntimePluginReference = {
  id: string;
  name: string;
  icon?: string;
};

export type RuntimePluginMention = { pluginId: string; label: string; start: number; end: number };

/** A textual reference survives draft restore, queued turns, retries and thread copies. */
export function pluginMentionText(plugin: Pick<RuntimePluginReference, 'id' | 'name'>): string {
  const label = plugin.name.replace(/[[\]\r\n]/gu, ' ').trim() || plugin.id;
  const id = encodeURIComponent(plugin.id).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16)}`);
  return `[$${label}](plugin://${id})`;
}

export function parsePluginMentions(content: string): RuntimePluginMention[] {
  const mentions: RuntimePluginMention[] = [];
  let fence: string | undefined;
  let offset = 0;
  for (const line of content.split('\n')) {
    const delimiter = /^[ \t]*(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length
        && !line.slice(delimiter[0].length).trim()) fence = undefined;
    } else if (delimiter) {
      fence = delimiter[1];
    } else {
      appendLineMentions(line, offset, mentions);
    }
    offset += line.length + 1;
  }
  return mentions;
}

function appendLineMentions(line: string, offset: number, mentions: RuntimePluginMention[]): void {
  const codeSpans = inlineCodeSpans(line);
  const labelBoundary = /[\]\r]/gu;
  const targetBoundary = /[\s)]/gu;
  const targetPrefix = '](plugin://';
  let labelEnd = -1;
  let targetEnd = -1;
  for (let cursor = 0; cursor < line.length;) {
    const codeEnd = codeSpans.get(cursor);
    if (codeEnd !== undefined) { cursor = codeEnd; continue; }
    if (!line.startsWith('[$', cursor)) { cursor += 1; continue; }
    const start = cursor;
    cursor += 2;
    // Cache forward-only delimiter searches. Many malformed openers must not
    // repeatedly scan the same suffix or keep the composer/runtime busy.
    if (labelEnd < cursor) {
      labelBoundary.lastIndex = cursor;
      labelEnd = labelBoundary.exec(line)?.index ?? line.length;
    }
    if (labelEnd === cursor || !line.startsWith(targetPrefix, labelEnd)) continue;
    const targetStart = labelEnd + targetPrefix.length;
    if (targetEnd < targetStart) {
      targetBoundary.lastIndex = targetStart;
      targetEnd = targetBoundary.exec(line)?.index ?? line.length;
    }
    if (targetEnd === targetStart || line[targetEnd] !== ')') continue;
    cursor = targetEnd + 1;
    try {
      const pluginId = decodeURIComponent(line.slice(targetStart, targetEnd));
      if (!pluginId || /[\s\p{Cc}]/u.test(pluginId)) continue;
      mentions.push({ pluginId, label: line.slice(start + 2, labelEnd), start: offset + start, end: offset + cursor });
    } catch { /* Malformed links remain ordinary text. */ }
  }
}

function inlineCodeSpans(line: string): Map<number, number> {
  const runs = [...line.matchAll(/`+/gu)];
  const nextByLength = new Map<number, number>();
  const spans = new Map<number, number>();
  // Pair equal backtick runs in one reverse pass; unmatched runs are literal text.
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    const next = nextByLength.get(run[0].length);
    spans.set(run.index, next ?? run.index + run[0].length);
    nextByLength.set(run[0].length, run.index + run[0].length);
  }
  return spans;
}
