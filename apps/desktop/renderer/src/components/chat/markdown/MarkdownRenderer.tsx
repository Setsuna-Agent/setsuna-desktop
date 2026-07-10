import { useMemo } from 'react';
import { splitThinkingContent } from '../chatThinkingContent.js';
import { MarkdownContentBlock } from './MarkdownContentBlock.js';
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
    });
  }, [content, streaming]);

  return (
    <>
      {visibleSegments.map((segment) => (
        <div
          className={`chat-markdown${segment.activeStreaming ? ' is-streaming' : ''}`}
          key={segment.key}
        >
          {/* Parser block positions are append-only; index keys keep the mutable tail mounted as its content grows. */}
          {segment.blocks.map((block, index) => (
            <div
              className={`chat-markdown__block${block.mutable ? ' is-mutable' : ''}`}
              data-markdown-block={block.mutable ? 'mutable' : 'stable'}
              key={`${segment.key}-block-${index}`}
            >
              <MarkdownContentBlock content={block.content} />
            </div>
          ))}
          {segment.activeStreaming && !segment.blocks.length ? (
            <span className="chat-markdown__empty-tail" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </>
  );
}
