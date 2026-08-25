import {
  normalizeRuntimeQueuedTurnInputKind,
  type RuntimeQueuedTurnInput,
} from '@setsuna-desktop/contracts';
import {
  MessageSquareText,
  Paperclip,
  SendHorizontal,
  Target,
  Trash2,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../../shared/ui/EditIcon.js';

type QueueAction = 'delete' | 'edit' | 'send';

export const ChatSendQueue = memo(function ChatSendQueue({
  disabled = false,
  editDisabled = false,
  hasActiveTurn = false,
  items,
  onDelete,
  onEdit,
  onSendNow,
}: {
  disabled?: boolean;
  editDisabled?: boolean;
  hasActiveTurn?: boolean;
  items: RuntimeQueuedTurnInput[];
  onDelete: (inputId: string) => Promise<boolean>;
  onEdit: (input: RuntimeQueuedTurnInput) => Promise<boolean>;
  onSendNow: (inputId: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [pendingAction, setPendingAction] = useState<{ inputId: string; type: QueueAction } | null>(null);

  if (!items.length) return null;

  const runItemAction = async (
    inputId: string,
    type: QueueAction,
    action: () => Promise<unknown>,
  ) => {
    if (pendingAction) return;
    setPendingAction({ inputId, type });
    try {
      await action();
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="chat-send-queue" aria-label={t('chat.queue.label')}>
      <ol className="chat-send-queue__list">
        {items.map((item) => {
          const kind = normalizeRuntimeQueuedTurnInputKind(item.kind);
          const MarkerIcon = kind === 'goal' ? Target : MessageSquareText;
          const kindLabel = kind === 'goal'
            ? t('chat.queue.kind.goal')
            : t('chat.queue.kind.message');
          const itemPending = pendingAction?.inputId === item.id;
          const attachments = item.attachments ?? [];
          const actionsDisabled = disabled || Boolean(pendingAction);
          const sendNowWaitsForCurrent = hasActiveTurn && kind !== 'message';
          const sendNowLabel = sendNowWaitsForCurrent
            ? t('chat.queue.sendNowWaitForCurrent')
            : t('chat.queue.sendNow');
          const editLabel = editDisabled
            ? t('chat.queue.editComposerNotEmpty')
            : t('chat.queue.edit');
          return (
            <li
              className={`chat-send-queue__item ${itemPending ? 'is-pending' : ''}`}
              data-queue-kind={kind}
              key={item.id}
            >
              <span
                className={`chat-send-queue__marker is-${kind}`}
                role="img"
                aria-label={kindLabel}
                title={kindLabel}
              >
                <MarkerIcon size={14} aria-hidden="true" />
              </span>
              <div className="chat-send-queue__content">
                <p className="chat-send-queue__text" title={item.input}>
                  {item.input || t('chat.queue.attachmentOnly')}
                </p>
                {attachments.length ? (
                  <span
                    className="chat-send-queue__attachments"
                    title={attachments.map((attachment) => attachment.name).join('、')}
                  >
                    <Paperclip size={12} aria-hidden="true" />
                    <span>{attachments.map((attachment) => attachment.name).join('、')}</span>
                  </span>
                ) : null}
              </div>
              <div className="chat-send-queue__actions">
                <button
                  className="chat-send-queue__send-now"
                  type="button"
                  disabled={actionsDisabled || sendNowWaitsForCurrent}
                  aria-label={sendNowLabel}
                  title={sendNowLabel}
                  onClick={() => void runItemAction(item.id, 'send', () => onSendNow(item.id))}
                >
                  <SendHorizontal size={13} aria-hidden="true" />
                  <span>{pendingAction?.type === 'send' && itemPending
                    ? t('chat.queue.sending')
                    : t('chat.queue.sendNow')}</span>
                </button>
                <button
                  className="chat-send-queue__icon-action"
                  type="button"
                  disabled={actionsDisabled || editDisabled}
                  aria-label={editLabel}
                  title={editLabel}
                  onClick={() => void runItemAction(item.id, 'edit', () => onEdit(item))}
                >
                  <EditIcon size={13} aria-hidden="true" />
                </button>
                <button
                  className="chat-send-queue__icon-action is-danger"
                  type="button"
                  disabled={actionsDisabled}
                  aria-label={pendingAction?.type === 'delete' && itemPending
                    ? t('chat.queue.deleting')
                    : t('chat.queue.delete')}
                  title={t('chat.queue.delete')}
                  onClick={() => void runItemAction(item.id, 'delete', () => onDelete(item.id))}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
