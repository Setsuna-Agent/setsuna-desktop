import { Lexer } from 'marked';
import remend from 'remend';

export type MarkdownRenderBlock = {
  content: string;
  mutable: boolean;
};

const documentScopedMarkdownPattern = /(?:\[\^[\w-]{1,200}\](?!:)|^\s{0,3}\[\^[\w-]{1,200}\]:|\[[^\]\n]+\]\[[^\]\n]*\]|^\s{0,3}\[[^\]\n]+\]:\s*\S)/m;

/**
 * 按解析器确定的块边界拆分 Markdown 文档。引用式链接和脚注保留在同一棵树中，
 * 因为它们的定义可能远离使用它们的节点。
 */
export function parseMarkdownBlocks(markdown: string): string[] {
  if (!markdown.trim()) return [];
  if (documentScopedMarkdownPattern.test(markdown)) return [markdown];

  try {
    return Lexer.lex(markdown, { gfm: true })
      .map((token) => token.raw)
      .filter((block) => block.trim().length > 0);
  } catch {
    // 即使边界词法分析器暂时无法分类最新片段，不完整的流式内容也应保持可读。
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
