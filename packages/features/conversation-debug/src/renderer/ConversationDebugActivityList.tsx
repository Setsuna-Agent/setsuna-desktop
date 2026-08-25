import type { CSSProperties } from 'react';
import { useConversationDebugI18n } from './context.js';
import {
  conversationDebugLaneLabel,
  conversationDebugNodeDescription,
  conversationDebugNodeTitle,
  conversationDebugStatusLabel,
} from './conversationDebugCopy.js';
import type { ConversationDebugNode } from './conversationDebugGraph.js';
import { useConversationDebugVirtualWindow } from './useConversationDebugVirtualWindow.js';

const ACTIVITY_ROW_HEIGHT = 68;
const ACTIVITY_LIST_PADDING_START = 6;
const ACTIVITY_LIST_PADDING_END = 18;
const ACTIVITY_LIST_OVERSCAN_ROWS = 8;

export function ConversationDebugActivityList({
  nodes,
  selectedNodeId,
  onSelectNode,
}: Readonly<{
  nodes: ConversationDebugNode[];
  selectedNodeId: string | null;
  onSelectNode: (node: ConversationDebugNode) => void;
}>) {
  const { locale, t } = useConversationDebugI18n();
  const virtualWindow = useConversationDebugVirtualWindow({
    itemCount: nodes.length,
    itemSize: ACTIVITY_ROW_HEIGHT,
    overscan: ACTIVITY_LIST_OVERSCAN_ROWS,
    paddingEnd: ACTIVITY_LIST_PADDING_END,
    paddingStart: ACTIVITY_LIST_PADDING_START,
  });
  const visibleNodes = nodes.slice(virtualWindow.startIndex, virtualWindow.endIndex);

  return (
    <div ref={virtualWindow.viewportRef} className="conversation-debug-activity">
      <ol
        className="conversation-debug-activity__canvas"
        aria-label={t('feature.conversationDebug.mode.events')}
        style={{ height: virtualWindow.totalSize }}
      >
        {visibleNodes.map((node, visibleIndex) => {
          const nodeIndex = virtualWindow.startIndex + visibleIndex;
          const title = conversationDebugNodeTitle(node, t);
          const description = conversationDebugNodeDescription(node, t);
          const recordCount = node.eventIds.length + node.traceIds.length;
          const selected = selectedNodeId === node.id;
          const top = {
            '--conversation-debug-activity-top':
              `${ACTIVITY_LIST_PADDING_START + nodeIndex * ACTIVITY_ROW_HEIGHT}px`,
          } as CSSProperties;
          return (
            <li
              aria-posinset={nodeIndex + 1}
              aria-setsize={nodes.length}
              key={node.id}
              style={top}
            >
              <button
                aria-pressed={selected}
                className={[
                  'conversation-debug-activity__item',
                  `conversation-debug-activity__item--${node.lane}`,
                  `conversation-debug-activity__item--${node.status}`,
                  selected ? 'is-selected' : '',
                ].filter(Boolean).join(' ')}
                title={description}
                type="button"
                onClick={() => onSelectNode(node)}
              >
                <i className="conversation-debug-activity__marker" aria-hidden="true" />
                <span className="conversation-debug-activity__body">
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <span className="conversation-debug-activity__meta">
                  <span>
                    {conversationDebugLaneLabel(node.lane, t)} ·{' '}
                    {conversationDebugStatusLabel(node.status, t)}
                  </span>
                  <span>
                    <time dateTime={node.startedAt}>
                      {new Date(node.startedAt).toLocaleTimeString(locale, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </time>
                    <em>{t('feature.conversationDebug.recordCountShort', { count: recordCount })}</em>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
