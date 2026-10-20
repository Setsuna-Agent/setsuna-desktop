import { memo, useMemo, useRef } from 'react';
import { OpenUiMarkdownDocument } from '../generative-ui/OpenUiMarkdownDocument.js';
import { splitOpenUiContent } from '../generative-ui/openUiContent.js';
import {
  literalThinkTagsForMarkdown,
  splitThinkingContent,
} from '../conversation/chatThinkingContent.js';
import { MarkdownVirtualBlock, shouldVirtualizeMarkdownBlocks } from './MarkdownVirtualBlock.js';
import {
  reconcileMarkdownRenderBlocks,
  type StreamingMarkdownRenderState,
} from './streamingMarkdown.js';
import { useSmoothedStreamingContent } from './useSmoothedStreamingContent.js';

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  legacyThinkingTags = true,
  allowOpenUi = false,
  streaming,
}: {
  content: string;
  legacyThinkingTags?: boolean;
  allowOpenUi?: boolean;
  streaming: boolean;
}) {
  const visibleSegments = useMemo(() => {
    if (!legacyThinkingTags) {
      return [{
        activeStreaming: streaming,
        content: literalThinkTagsForMarkdown(content),
        key: 'markdown-0',
      }];
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
          allowOpenUi={allowOpenUi}
          content={segment.content}
          key={segment.key}
          segmentKey={segment.key}
          streaming={segment.activeStreaming}
        />
      ))}
    </>
  );
});

function MarkdownSegment({
  allowOpenUi,
  content,
  segmentKey,
  streaming,
}: {
  allowOpenUi: boolean;
  content: string;
  segmentKey: string;
  streaming: boolean;
}) {
  const parts = useMemo(() => allowOpenUi ? splitOpenUiContent(content) : [
    { kind: 'markdown' as const, key: 'markdown-0', content },
  ], [allowOpenUi, content]);

  if (parts.some((part) => part.kind === 'openui')) {
    return <OpenUiMarkdownDocument content={content} parts={parts} streaming={streaming} />;
  }
  return <MarkdownTextSegment content={content} segmentKey={segmentKey} streaming={streaming} />;
}

function MarkdownTextSegment({
  content,
  segmentKey,
  streaming,
}: {
  content: string;
  segmentKey: string;
  streaming: boolean;
}) {
  const renderStateRef = useRef<StreamingMarkdownRenderState | null>(null);
  const visibleContent = useSmoothedStreamingContent(content, streaming);
  const blocks = useMemo(() => {
    const result = reconcileMarkdownRenderBlocks(renderStateRef.current, visibleContent, streaming);
    renderStateRef.current = result.state;
    return result.blocks;
  }, [streaming, visibleContent]);
  const virtualized = shouldVirtualizeMarkdownBlocks(blocks);

  return (
    <div className="chat-markdown" aria-busy={streaming}>
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
