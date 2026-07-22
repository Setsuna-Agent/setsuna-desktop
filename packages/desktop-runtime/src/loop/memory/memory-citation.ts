import type { RuntimeMemoryCitation, RuntimeMemoryCitationEntry } from '@setsuna-desktop/contracts';

const MEMORY_CITATION_OPEN = '<oai-mem-citation>';
const MEMORY_CITATION_CLOSE = '</oai-mem-citation>';

export type MemoryCitationStreamChunk = {
  visibleText: string;
  citations: string[];
};

export class MemoryCitationStreamParser {
  private pending = '';
  private activeContent: string | null = null;

  push(chunk: string): MemoryCitationStreamChunk {
    this.pending += chunk;
    return this.drain(false);
  }

  finish(): MemoryCitationStreamChunk {
    return this.drain(true);
  }

  private drain(finish: boolean): MemoryCitationStreamChunk {
    const out: MemoryCitationStreamChunk = { visibleText: '', citations: [] };

    while (this.pending) {
      if (this.activeContent !== null) {
        const closeIndex = this.pending.indexOf(MEMORY_CITATION_CLOSE);
        if (closeIndex >= 0) {
          this.activeContent += this.pending.slice(0, closeIndex);
          out.citations.push(this.activeContent);
          this.pending = this.pending.slice(closeIndex + MEMORY_CITATION_CLOSE.length);
          this.activeContent = null;
          continue;
        }

        const keep = longestSuffixPrefixLength(this.pending, MEMORY_CITATION_CLOSE);
        const take = this.pending.length - keep;
        if (take > 0) {
          this.activeContent += this.pending.slice(0, take);
          this.pending = this.pending.slice(take);
        }
        break;
      }

      const openIndex = this.pending.indexOf(MEMORY_CITATION_OPEN);
      if (openIndex >= 0) {
        out.visibleText += this.pending.slice(0, openIndex);
        this.pending = this.pending.slice(openIndex + MEMORY_CITATION_OPEN.length);
        this.activeContent = '';
        continue;
      }

      const keep = finish ? 0 : longestSuffixPrefixLength(this.pending, MEMORY_CITATION_OPEN);
      const take = this.pending.length - keep;
      if (take > 0) {
        out.visibleText += this.pending.slice(0, take);
        this.pending = this.pending.slice(take);
      }
      break;
    }

    if (finish) {
      if (this.activeContent !== null) {
        this.activeContent += this.pending;
        out.citations.push(this.activeContent);
        this.activeContent = null;
        this.pending = '';
      } else if (this.pending) {
        out.visibleText += this.pending;
        this.pending = '';
      }
    }

    return out;
  }
}

export function parseMemoryCitationBodies(citations: string[]): RuntimeMemoryCitation | undefined {
  const entries: RuntimeMemoryCitationEntry[] = [];
  const rolloutIds: string[] = [];
  const seenRolloutIds = new Set<string>();

  for (const citation of citations) {
    const entriesBlock = extractBlock(citation, '<citation_entries>', '</citation_entries>');
    if (entriesBlock) {
      for (const line of entriesBlock.split(/\r?\n/)) {
        const entry = parseMemoryCitationEntry(line);
        if (entry) entries.push(entry);
      }
    }

    const idsBlock = extractBlock(citation, '<rollout_ids>', '</rollout_ids>') ?? extractBlock(citation, '<thread_ids>', '</thread_ids>');
    if (idsBlock) {
      for (const line of idsBlock.split(/\r?\n/)) {
        const id = line.trim();
        if (!id || seenRolloutIds.has(id)) continue;
        seenRolloutIds.add(id);
        rolloutIds.push(id);
      }
    }
  }

  if (!entries.length && !rolloutIds.length) return undefined;
  return { entries, rolloutIds };
}

export function stripMemoryCitations(text: string): { visibleText: string; citationBodies: string[]; memoryCitation?: RuntimeMemoryCitation } {
  const parser = new MemoryCitationStreamParser();
  const first = parser.push(text);
  const tail = parser.finish();
  const citationBodies = [...first.citations, ...tail.citations];
  return {
    visibleText: `${first.visibleText}${tail.visibleText}`,
    citationBodies,
    memoryCitation: parseMemoryCitationBodies(citationBodies),
  };
}

function parseMemoryCitationEntry(value: string): RuntimeMemoryCitationEntry | null {
  const line = value.trim();
  if (!line) return null;

  const noteSplit = rsplitOnce(line, '|note=[');
  if (!noteSplit) return null;
  const [location, rawNote] = noteSplit;
  if (!rawNote.endsWith(']')) return null;
  const pathSplit = rsplitOnce(location, ':');
  if (!pathSplit) return null;
  const [path, rawRange] = pathSplit;
  const rangeSplit = splitOnce(rawRange, '-');
  if (!rangeSplit) return null;
  const lineStart = parsePositiveInteger(rangeSplit[0].trim());
  const lineEnd = parsePositiveInteger(rangeSplit[1].trim());
  if (lineStart === null || lineEnd === null) return null;

  return {
    path: path.trim(),
    lineStart,
    lineEnd,
    note: rawNote.slice(0, -1).trim(),
  };
}

function extractBlock(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;
  const bodyStart = start + open.length;
  const end = text.indexOf(close, bodyStart);
  if (end < 0) return null;
  return text.slice(bodyStart, end);
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function splitOnce(value: string, delimiter: string): [string, string] | null {
  const index = value.indexOf(delimiter);
  if (index < 0) return null;
  return [value.slice(0, index), value.slice(index + delimiter.length)];
}

function rsplitOnce(value: string, delimiter: string): [string, string] | null {
  const index = value.lastIndexOf(delimiter);
  if (index < 0) return null;
  return [value.slice(0, index), value.slice(index + delimiter.length)];
}

function longestSuffixPrefixLength(value: string, prefixOf: string): number {
  const max = Math.min(value.length, prefixOf.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (value.endsWith(prefixOf.slice(0, length))) return length;
  }
  return 0;
}
