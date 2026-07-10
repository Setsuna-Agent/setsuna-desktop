import { Lexer } from 'marked';
import remend from 'remend';

export type MarkdownRenderBlock = {
  content: string;
  mutable: boolean;
};

const documentScopedMarkdownPattern = /(?:\[\^[\w-]{1,200}\](?!:)|^\s{0,3}\[\^[\w-]{1,200}\]:|\[[^\]\n]+\]\[[^\]\n]*\]|^\s{0,3}\[[^\]\n]+\]:\s*\S)/m;

/**
 * Split a Markdown document on parser-owned block boundaries. Reference-style
 * links and footnotes stay in one tree because their definitions may live far
 * away from the node that consumes them.
 */
export function parseMarkdownBlocks(markdown: string): string[] {
  if (!markdown.trim()) return [];
  if (documentScopedMarkdownPattern.test(markdown)) return [markdown];

  try {
    return Lexer.lex(markdown, { gfm: true })
      .map((token) => token.raw)
      .filter((block) => block.trim().length > 0);
  } catch {
    // A partial stream should remain readable even if the boundary lexer cannot
    // classify the newest fragment yet.
    return [markdown];
  }
}

export function createMarkdownRenderBlocks(markdown: string, streaming: boolean): MarkdownRenderBlock[] {
  const renderSource = streaming
    ? remend(markdown, {
        linkMode: 'text-only',
        inlineKatex: false,
        katex: true,
      })
    : markdown;
  const blocks = parseMarkdownBlocks(renderSource);
  return blocks.map((content, index) => ({
    content,
    mutable: streaming && index === blocks.length - 1,
  }));
}
