import { useMemo } from 'react';
import { splitThinkingContent } from '../chatThinkingContent.js';
import { MarkdownVirtualBlock, shouldVirtualizeMarkdownBlocks } from './MarkdownVirtualBlock.js';
import { createMarkdownRenderBlocks } from './streamingMarkdown.js';

export function MarkdownRenderer({ content, streaming }: { content: string; streaming: boolean }) {
  const visibleSegments = useMemo(() => {
    const segments = splitThinkingContent(content);
    return segments.flatMap((segment, index) => {
      if (segment.type === 'think') return [];
      const activeStreaming = streaming
        && index === segments.length - 1
        && (segment.type === 'markdown' || !segment.closed);
      return [{
        activeStreaming,
        blocks: createMarkdownRenderBlocks(segment.content, activeStreaming),
        key: `markdown-${index}`,
      }];
    }).map((segment) => ({
      ...segment,
      virtualized: shouldVirtualizeMarkdownBlocks(segment.blocks),
    }));
  }, [content, streaming]);

  return (
    <>
      {visibleSegments.map((segment) => (
        <div
          className={`chat-markdown${segment.activeStreaming ? ' is-streaming' : ''}`}
          key={segment.key}
        >
          {/* 解析器块位置仅会追加；使用索引键可在可变尾部内容增长时保持其挂载。 */}
          {segment.blocks.map((block, index) => (
            <MarkdownVirtualBlock
              content={block.content}
              forceRender={block.mutable}
              key={`${segment.key}-block-${index}`}
              mutable={block.mutable}
              virtualized={segment.virtualized}
            />
          ))}
          {segment.activeStreaming && !segment.blocks.length ? (
            <span className="chat-markdown__empty-tail" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </>
  );
}
