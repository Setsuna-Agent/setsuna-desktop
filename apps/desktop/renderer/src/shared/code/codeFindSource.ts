import type { FileDiffMetadata, SelectionSide } from '@pierre/diffs';
import { contentFindNodeKey, literalFindExpression, type ContentFindMatch, type ContentFindSource } from '../find/contentFindSources.js';

type CodeFindLine = {
  line: number;
  text: string;
  type: 'file' | 'context' | 'addition' | 'deletion';
  oldLine?: number;
  side?: SelectionSide;
};
type CodeFindPosition = CodeFindLine & { start: number; end: number };

export function createCodeFindSource(
  element: HTMLElement,
  lines: () => Iterable<CodeFindLine>,
  reveal: (position: CodeFindPosition) => void,
): ContentFindSource {
  let previousQuery: string | undefined;
  let matches: ContentFindMatch[] = [];
  let rendered = new Map<string, HTMLElement>();
  return {
    element,
    find(query) {
      if (!query) {
        previousQuery = undefined;
        matches = [];
        rendered.clear();
        return matches;
      }
      // Build once per paint, rather than querying the DOM for every unmounted match.
      rendered = renderedCodeLines(element);
      if (query !== previousQuery) {
        previousQuery = query;
        const positions: CodeFindPosition[] = [];
        const expression = literalFindExpression(query);
        for (const line of lines()) {
          for (const match of line.text.matchAll(expression)) {
            positions.push({ ...line, start: match.index, end: match.index + match[0].length });
          }
        }
        matches = positions.map((position) => ({
          key: `${contentFindNodeKey(element)}:${position.type}:${position.line}:${position.start}`,
          element,
          reveal: () => reveal(position),
          getRanges: () => {
            const key = position.type === 'file' ? 'context' : position.type;
            const rows = [rendered.get(`${key}:${position.line}`)];
            if (position.type === 'context') rows.push(rendered.get(`old-context:${position.oldLine}`));
            return rows.flatMap((row) => {
              const range = row?.isConnected ? codeTextRange(row, position.start, position.end) : null;
              return range ? [range] : [];
            });
          },
        }));
      }
      return matches;
    },
  };
}

export function* codeFileFindLines(content: string): Generator<CodeFindLine> {
  let line = 0;
  for (const text of content.split(/\r?\n/)) yield { line: ++line, text, type: 'file' };
}

/** Context appears in both split columns, but represents one search result. */
export function* codeDiffFindLines(diff: FileDiffMetadata): Generator<CodeFindLine> {
  for (const hunk of diff.hunks) {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    for (const part of hunk.hunkContent) {
      if (part.type === 'context') {
        for (let index = 0; index < part.lines; index += 1) {
          yield { line: newLine++, oldLine: oldLine++, type: 'context', side: 'additions', text: diff.additionLines[part.additionLineIndex + index] };
        }
      } else {
        for (let index = 0; index < part.deletions; index += 1) {
          yield { line: oldLine++, type: 'deletion', side: 'deletions', text: diff.deletionLines[part.deletionLineIndex + index] };
        }
        for (let index = 0; index < part.additions; index += 1) {
          yield { line: newLine++, type: 'addition', side: 'additions', text: diff.additionLines[part.additionLineIndex + index] };
        }
      }
    }
  }
}

function renderedCodeLines(element: HTMLElement): Map<string, HTMLElement> {
  const lines = new Map<string, HTMLElement>();
  const hosts = element.matches('diffs-container') ? [element] : [...element.querySelectorAll<HTMLElement>('diffs-container')];
  for (const host of hosts) {
    for (const row of host.shadowRoot?.querySelectorAll<HTMLElement>('[data-line]') ?? []) {
      const type = row.dataset.lineType;
      const key = type === 'change-addition' ? 'addition' : type === 'change-deletion' ? 'deletion'
        : row.closest('[data-deletions]') ? 'old-context' : 'context';
      lines.set(`${key}:${row.dataset.line}`, row);
    }
  }
  return lines;
}

function codeTextRange(element: HTMLElement, start: number, end: number): Range | null {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = element.ownerDocument.createRange();
  let offset = 0;
  let foundStart = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const next = offset + (node.textContent?.length ?? 0);
    if (!foundStart && next > start) {
      range.setStart(node, start - offset);
      foundStart = true;
    }
    if (foundStart && next >= end) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset = next;
  }
  return null;
}
