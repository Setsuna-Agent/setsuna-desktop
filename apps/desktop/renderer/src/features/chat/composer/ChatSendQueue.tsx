import { Button, CollapsibleList, CollapsibleListItem } from '@setsuna-desktop/renderer-ui';
import { parseBrowserAnnotationMessage } from '@setsuna-desktop/feature-browser/contracts';
import {
  normalizeRuntimeQueuedTurnInputKind,
  type RuntimeQueuedTurnInput,
} from '@setsuna-desktop/contracts';
import {
  Forward,
  Goal as GoalIcon,
  GripVertical,
  MessageSquareText,
  Paperclip,
  Trash2,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../../shared/ui/EditIcon.js';
import { BrowserAnnotationReference } from '../mentions/BrowserAnnotationReference.js';
import { useChatSendQueueReorder } from './useChatSendQueueReorder.js';

type QueueAction = 'delete' | 'edit' | 'send';

export const ChatSendQueue = memo(function ChatSendQueue({
  disabled = false,
  hasActiveTurn = false,
  items,
  onDelete,
  onEdit,
  onReorder,
  onSendNow,
}: {
  disabled?: boolean;
  hasActiveTurn?: boolean;
  items: RuntimeQueuedTurnInput[];
  onDelete: (inputId: string) => Promise<boolean>;
  onEdit: (input: RuntimeQueuedTurnInput) => Promise<boolean>;
  onReorder: (inputIds: string[]) => Promise<boolean>;
  onSendNow: (inputId: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [pendingAction, setPendingAction] = useState<{ inputId: string; type: QueueAction } | null>(null);
  const reorder = useChatSendQueueReorder({ disabled: disabled || Boolean(pendingAction), items, onReorder });
  // mounted：随会话挂载时已有的条目不播放入场；revealed：空队列后新出现的条目展开进入；
  // hidden：最后一条收拢完成后才卸载外壳，避免整块瞬间消失。
  const [presence, setPresence] = useState<'mounted' | 'revealed' | 'hidden'>(items.length ? 'mounted' : 'hidden');
  if (items.length && presence === 'hidden') setPresence('revealed');

  if (presence === 'hidden') return null;

  const runItemAction = async (
    inputId: string,
    type: QueueAction,
    action: () => Promise<unknown>,
  ) => {
    if (pendingAction || reorder.saving || reorder.draggedInputId) return;
    setPendingAction({ inputId, type });
    try {
      await action();
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="chat-send-queue" aria-label={t('chat.queue.label')} aria-busy={reorder.saving}>
      <ol className="chat-send-queue__list" ref={reorder.listRef} {...reorder.listProps}>
        <CollapsibleList
          initial={presence === 'revealed'}
          onExitComplete={() => { if (!items.length) setPresence('hidden'); }}
        >
          {items.map((item) => {
            const annotationMessage = parseBrowserAnnotationMessage(item.input);
            const kind = normalizeRuntimeQueuedTurnInputKind(item.kind);
            const MarkerIcon = kind === 'goal' ? GoalIcon : MessageSquareText;
            const kindLabel = kind === 'goal'
              ? t('chat.queue.kind.goal')
              : t('chat.queue.kind.message');
            const itemPending = pendingAction?.inputId === item.id;
            const attachments = item.attachments ?? [];
            const actionsDisabled = disabled || Boolean(pendingAction) || reorder.saving || Boolean(reorder.draggedInputId);
            const sendNowWaitsForCurrent = hasActiveTurn && kind !== 'message';
            const sendNowLabel = sendNowWaitsForCurrent
              ? t('chat.queue.sendNowWaitForCurrent')
              : t('chat.queue.sendNow');
            return (
              <CollapsibleListItem
                className={[
                  'chat-send-queue__item',
                  itemPending ? 'is-pending' : '',
                  reorder.previewInputId === item.id ? 'is-dragging' : '',
                ].filter(Boolean).join(' ')}
                data-queue-id={item.id}
                data-reorder-id={item.id}
                data-queue-kind={kind}
                key={item.id}
              >
                <div className="chat-send-queue__row">
                  <Button
                    variant="ghost"
                    className={`chat-send-queue__marker chat-send-queue__drag-handle is-${kind}`}
                    aria-label={`${kindLabel} · ${t('chat.queue.reorder')}`}
                    title={t('chat.queue.reorder')}
                    {...reorder.handleProps(item.id)}
                  >
                    <MarkerIcon className="chat-send-queue__kind-icon" size={14} aria-hidden="true" />
                    <GripVertical className="chat-send-queue__grip-icon" size={14} aria-hidden="true" />
                  </Button>
                  <div className="chat-send-queue__content">
                    {annotationMessage ? <BrowserAnnotationReference message={annotationMessage} /> : <p className="chat-send-queue__text" title={item.input}>
                      {item.input || t('chat.queue.attachmentOnly')}
                    </p>}
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
                    <Button variant="ghost"
                      className="chat-send-queue__send-now"
                      type="button"
                      disabled={actionsDisabled || sendNowWaitsForCurrent}
                      aria-label={sendNowLabel}
                      title={sendNowLabel}
                      onClick={() => void runItemAction(item.id, 'send', () => onSendNow(item.id))}
                    >
                      <Forward size={13} aria-hidden="true" />
                      <span>{pendingAction?.type === 'send' && itemPending
                        ? t('chat.queue.sending')
                        : t('chat.queue.sendNow')}</span>
                    </Button>
                    <Button variant="ghost"
                      className="chat-send-queue__icon-action"
                      type="button"
                      disabled={actionsDisabled}
                      aria-label={t('chat.queue.edit')}
                      title={t('chat.queue.edit')}
                      onClick={() => void runItemAction(item.id, 'edit', () => onEdit(item))}
                    >
                      <EditIcon size={13} aria-hidden="true" />
                    </Button>
                    <Button variant="danger"
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
                    </Button>
                  </div>
                </div>
              </CollapsibleListItem>
            );
          })}
        </CollapsibleList>
      </ol>
    </section>
  );
});
