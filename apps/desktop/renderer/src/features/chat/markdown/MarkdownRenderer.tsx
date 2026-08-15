import { useMemo, useRef } from 'react';
import { splitThinkingContent } from '../conversation/chatThinkingContent.js';
import { MarkdownVirtualBlock, shouldVirtualizeMarkdownBlocks } from './MarkdownVirtualBlock.js';
import {
  reconcileMarkdownRenderBlocks,
  type StreamingMarkdownRenderState,
} from './streamingMarkdown.js';

export function MarkdownRenderer({
  content,
  legacyThinkingTags = true,
  streaming,
}: {
  content: string;
  legacyThinkingTags?: boolean;
  streaming: boolean;
}) {
  const visibleSegments = useMemo(() => {
    if (!legacyThinkingTags) {
      return [{ activeStreaming: streaming, content, key: 'markdown-0' }];
    }
    const segments = splitThinkingContent(content, streaming);
    return segments.flatMap((segment, index) => {
      if (segment.type === 'think') return [];
      const activeStreaming = streaming
        && index === segments.length - 1
        && (segment.type === 'markdown' || !segment.closed);
      return [{
        activeStreaming,
        content: segment.content,
        key: `markdown-${index}`,
      }];
    });
  }, [content, legacyThinkingTags, streaming]);

  return (
    <>
      {visibleSegments.map((segment) => (
        <MarkdownSegment
          content={segment.content}
          key={segment.key}
          segmentKey={segment.key}
          streaming={segment.activeStreaming}
        />
      ))}
    </>
  );
}

function MarkdownSegment({
  content,
  segmentKey,
  streaming,
}: {
  content: string;
  segmentKey: string;
  streaming: boolean;
}) {
  const renderStateRef = useRef<StreamingMarkdownRenderState | null>(null);
  const blocks = useMemo(() => {
    const result = reconcileMarkdownRenderBlocks(renderStateRef.current, content, streaming);
    renderStateRef.current = result.state;
    return result.blocks;
  }, [content, streaming]);
  const virtualized = shouldVirtualizeMarkdownBlocks(blocks);

  return (
    <div className="chat-markdown">
      {/* Stable positions only append while streaming, preserving mounted expensive blocks. */}
      {blocks.map((block, index) => (
        <MarkdownVirtualBlock
          content={block.content}
          forceRender={block.mutable}
          key={`${segmentKey}-block-${index}`}
          mutable={block.mutable}
          virtualized={virtualized}
        />
      ))}
    </div>
  );
}
