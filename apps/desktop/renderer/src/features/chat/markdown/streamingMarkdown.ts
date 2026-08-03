import { Lexer } from 'marked';
import remend from 'remend';

export type MarkdownRenderBlock = {
  content: string;
  mutable: boolean;
};

export type StreamingMarkdownRenderState = {
  source: string;
  stableContents: string[];
  tailSource: string;
};

export type MarkdownRenderReconciliation = {
  blocks: MarkdownRenderBlock[];
  state: StreamingMarkdownRenderState | null;
};

type MarkdownTokenBoundary = {
  content: string;
  end: number;
  visible: boolean;
};

// Shortcut references have no syntactic suffix until a later definition arrives.
const documentScopedMarkdownPattern = /(?:\[\^[\w-]{1,200}\](?!:)|!?\[[^\]\n]+\]\[[^\]\n]*\]|!?\[(?!\^)[^\]\n]*[^\s\]\n][^\]\n]*\](?!\s*(?:\(|\[|:))|^\s{0,3}\[[^\]\n]+\]:)/m;

/**
 * 按解析器确定的块边界拆分 Markdown 文档。引用式链接和脚注保留在同一棵树中，
 * 因为它们的定义可能远离使用它们的节点。
 */
export function parseMarkdownBlocks(markdown: string): string[] {
  if (!markdown.trim()) return [];
  if (documentScopedMarkdownPattern.test(markdown)) return [markdown];

  try {
    return Lexer.lex(markdown, { gfm: true })
      .filter((token) => {
        // MarkdownContentBlock enables skipHtml, so top-level HTML tokens produce no
        // layout box. Keeping them would make virtualization alternate between an
        // estimated-height placeholder and a zero-height rendered block.
        return token.type !== 'html' && token.raw.trim().length > 0;
      })
      .map((token) => token.raw);
  } catch {
    // 即使边界词法分析器暂时无法分类最新片段，不完整的流式内容也应保持可读。
    return [markdown];
  }
}

export function createMarkdownRenderBlocks(markdown: string, streaming: boolean): MarkdownRenderBlock[] {
  return reconcileMarkdownRenderBlocks(null, markdown, streaming).blocks;
}

/**
 * Reuses parser-confirmed block prefixes across append-only stream updates. Only the
 * unresolved tail is repaired and lexed again; completion always rebuilds from the
 * exact stored Markdown so synthetic streaming terminators cannot leak into history.
 */
export function reconcileMarkdownRenderBlocks(
  previous: StreamingMarkdownRenderState | null,
  markdown: string,
  streaming: boolean,
): MarkdownRenderReconciliation {
  if (!streaming) {
    return {
      blocks: parseMarkdownBlocks(markdown).map((content) => ({ content, mutable: false })),
      state: null,
    };
  }

  const appendState = previous && markdown.startsWith(previous.source) ? previous : null;
  const stableContents = appendState?.stableContents ?? [];
  const tailSource = appendState
    ? `${appendState.tailSource}${markdown.slice(appendState.source.length)}`
    : markdown;
  const partition = partitionStreamingTail(tailSource);
  const nextStableContents = partition.stableContents.length
    ? [...stableContents, ...partition.stableContents]
    : stableContents;
  const repairedTail = repairStreamingMarkdown(partition.tailSource);
  const mutableContents = unclosedBlockMathOffset(partition.tailSource) === null
    ? parseMarkdownBlocks(repairedTail)
    : (repairedTail.trim() ? [repairedTail] : []);
  const mutableBlocks = mutableContents
    .map((content) => ({ content, mutable: true }));

  return {
    blocks: [
      ...nextStableContents.map((content) => ({ content, mutable: false })),
      ...mutableBlocks,
    ],
    state: {
      source: markdown,
      stableContents: nextStableContents,
      tailSource: partition.tailSource,
    },
  };
}

function partitionStreamingTail(source: string): {
  stableContents: string[];
  tailSource: string;
} {
  const tokens = markdownTokenBoundaries(source);
  if (!tokens) return { stableContents: [], tailSource: source };

  const visibleTokens = tokens.filter((token) => token.visible);
  if (visibleTokens.length < 2) return { stableContents: [], tailSource: source };

  // The final visible token can still become a table, setext heading, list, or
  // fenced block. References and unmatched display math keep their following scope
  // in one ReactMarkdown tree so later definitions or delimiters can still resolve it.
  const mutableScopeStart = earliestOffset(
    documentScopedMarkdownOffset(source),
    unclosedBlockMathOffset(source),
  );
  const candidates = visibleTokens.slice(0, -1);
  const stableTokens = mutableScopeStart === null
    ? candidates
    : candidates.filter((token) => token.end <= mutableScopeStart);
  const lastStable = stableTokens.at(-1);
  if (!lastStable) return { stableContents: [], tailSource: source };

  return {
    stableContents: stableTokens.map((token) => token.content),
    tailSource: source.slice(lastStable.end),
  };
}

function markdownTokenBoundaries(markdown: string): MarkdownTokenBoundary[] | null {
  try {
    const tokens = Lexer.lex(markdown, { gfm: true });
    const boundaries: MarkdownTokenBoundary[] = [];
    let cursor = 0;
    for (const token of tokens) {
      const start = markdown.indexOf(token.raw, cursor);
      if (start < 0) return null;
      const end = start + token.raw.length;
      boundaries.push({
        content: token.raw,
        end,
        visible: token.type !== 'html' && token.raw.trim().length > 0,
      });
      cursor = end;
    }
    return boundaries;
  } catch {
    return null;
  }
}

function documentScopedMarkdownOffset(markdown: string): number | null {
  return documentScopedMarkdownPattern.exec(markdown)?.index ?? null;
}

/** Finds an unmatched display-math delimiter while ignoring Markdown code spans. */
function unclosedBlockMathOffset(markdown: string): number | null {
  let codeFence: { character: '`' | '~'; length: number } | null = null;
  let inlineCodeTicks = 0;
  let mathStart: number | null = null;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const lineEnd = markdown.indexOf('\n', lineStart);
    const contentEnd = lineEnd < 0 ? markdown.length : lineEnd;
    const line = markdown.slice(lineStart, contentEnd);
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      const character = fence[0] as '`' | '~';
      if (!codeFence) codeFence = { character, length: fence.length };
      else if (codeFence.character === character && fence.length >= codeFence.length) codeFence = null;
      lineStart = contentEnd + 1;
      continue;
    }
    if (codeFence) {
      lineStart = contentEnd + 1;
      continue;
    }

    for (let index = lineStart; index < contentEnd; index += 1) {
      if (markdown[index] === '\\') {
        index += 1;
        continue;
      }
      if (markdown[index] === '`') {
        let runLength = 1;
        while (markdown[index + runLength] === '`') runLength += 1;
        if (inlineCodeTicks === 0) inlineCodeTicks = runLength;
        else if (inlineCodeTicks === runLength) inlineCodeTicks = 0;
        index += runLength - 1;
        continue;
      }
      if (inlineCodeTicks === 0 && markdown[index] === '$' && markdown[index + 1] === '$') {
        mathStart = mathStart === null ? index : null;
        index += 1;
      }
    }
    lineStart = contentEnd + 1;
  }

  return mathStart;
}

function earliestOffset(...offsets: Array<number | null>): number | null {
  const present = offsets.filter((offset): offset is number => offset !== null);
  return present.length ? Math.min(...present) : null;
}

function repairStreamingMarkdown(markdown: string): string {
  return remend(markdown, {
    linkMode: 'text-only',
    inlineKatex: false,
    katex: true,
  });
}
