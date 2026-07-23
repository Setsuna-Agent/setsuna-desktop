import { useEffect, useRef } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { conversationDebugStatusLabel } from './conversationDebugCopy.js';
import type { ConversationDebugTurnGroup } from './conversationDebugGraph.js';

type ConversationDebugTurnNavigatorProps = {
  activeTurnId: string | null;
  turns: ConversationDebugTurnGroup[];
  onNavigate: (turnId: string) => void;
};

export function ConversationDebugTurnNavigator({
  activeTurnId,
  turns,
  onNavigate,
}: ConversationDebugTurnNavigatorProps) {
  const { t } = useI18n();
  const activeTurnButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeTurnButtonRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeTurnId]);

  if (!turns.length) return null;

  return (
    <nav
      aria-label={t('conversationDebug.canvas.turnNavigation')}
      className="conversation-debug-flow__navigator"
    >
      <ol className="conversation-debug-flow__navigator-track">
        {turns.map((turn, index) => {
          const label = t('conversationDebug.turnLabel', { index: index + 1 });
          const status = conversationDebugStatusLabel(turn.status, t);
          const preview = turn.inputPreview || status;
          return (
            <li key={turn.id}>
              <button
                aria-current={activeTurnId === turn.id ? 'step' : undefined}
                aria-label={t('conversationDebug.canvas.jumpToTurn', {
                  index: index + 1,
                  status,
                })}
                className="conversation-debug-flow__navigator-turn"
                ref={activeTurnId === turn.id ? activeTurnButtonRef : undefined}
                title={`${label} · ${status} · ${preview}`}
                type="button"
                onClick={() => onNavigate(turn.id)}
              >
                <span>{index + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
