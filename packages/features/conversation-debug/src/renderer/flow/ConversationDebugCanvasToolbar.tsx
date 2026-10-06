import { Button } from '@setsuna-desktop/renderer-ui';
import { Minus, Plus } from 'lucide-react';
import { useConversationDebugI18n } from '../context.js';
import { conversationDebugLaneLabel } from '../conversationDebugCopy.js';
import { CONVERSATION_DEBUG_LANES } from '../conversationDebugGraph.js';

export function ConversationDebugCanvasToolbar({
  canZoomIn,
  canZoomOut,
  zoom,
  onReset,
  onZoomIn,
  onZoomOut,
}: Readonly<{
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoom: number;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}>) {
  const { t } = useConversationDebugI18n();
  return (
    <div className="conversation-debug-flow__toolbar">
      <div
        aria-label={t('feature.conversationDebug.canvas.legend')}
        className="conversation-debug-flow__legend"
        role="group"
      >
        {CONVERSATION_DEBUG_LANES.map((lane) => (
          <span
            className={`conversation-debug-flow__legend-item conversation-debug-flow__legend-item--${lane}`}
            key={lane}
          >
            <i aria-hidden="true" />
            {conversationDebugLaneLabel(lane, t)}
          </span>
        ))}
      </div>
      <div
        aria-label={t('feature.conversationDebug.canvas.controls')}
        className="conversation-debug-flow__controls"
        role="group"
      >
        <Button
          variant="ghost"
          aria-label={t('feature.conversationDebug.canvas.zoomOut')}
          disabled={!canZoomOut}
          title={t('feature.conversationDebug.canvas.zoomOut')}
          type="button"
          onClick={onZoomOut}
        >
          <Minus aria-hidden="true" size={15} strokeWidth={1.8} />
        </Button>
        <Button
          variant="ghost"
          aria-label={t('feature.conversationDebug.canvas.zoomReset')}
          className="conversation-debug-flow__zoom-value"
          title={t('feature.conversationDebug.canvas.zoomReset')}
          type="button"
          onClick={onReset}
        >
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          variant="ghost"
          aria-label={t('feature.conversationDebug.canvas.zoomIn')}
          disabled={!canZoomIn}
          title={t('feature.conversationDebug.canvas.zoomIn')}
          type="button"
          onClick={onZoomIn}
        >
          <Plus aria-hidden="true" size={15} strokeWidth={1.8} />
        </Button>
      </div>
    </div>
  );
}
