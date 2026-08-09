import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useI18n, type AppLocale } from '../../../shared/i18n/I18nProvider.js';
import { copyTextToClipboard } from '../../../shared/lib/clipboard.js';
import { ActionTooltip } from '../../../shared/ui/primitives.js';

const timeFormatters = new Map<AppLocale, Intl.DateTimeFormat>();

export function ChatMessageFooter({
  actionsDisabled = false,
  align = 'start',
  message,
  onDelete,
  onEdit,
  timePosition = 'before-actions',
}: {
  actionsDisabled?: boolean;
  align?: 'start' | 'end';
  message: RuntimeMessage;
  onDelete?: () => void;
  onEdit?: () => void;
  timePosition?: 'before-actions' | 'after-actions' | 'none';
}) {
  const { locale, t } = useI18n();
  const [copied, setCopied] = useState(false);
  const formattedTime = useMemo(() => formatTime(message.createdAt, locale), [locale, message.createdAt]);

  const copyMessage = async () => {
    if (!message.content) return;
    try {
      await copyTextToClipboard(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  const timeNode = (
    <time className="chat-message-footer__time" dateTime={message.createdAt} title={formattedTime}>
      {formattedTime}
    </time>
  );
  const actionNodes = (
    <>
      <MessageFooterAction active={copied} disabled={!message.content} label={copied ? t('chat.message.copied') : t('chat.message.copy')} onClick={() => void copyMessage()}>
        <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
      </MessageFooterAction>
      {onDelete ? (
        <MessageFooterAction disabled={actionsDisabled} label={t('common.delete')} onClick={onDelete}>
          <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
        </MessageFooterAction>
      ) : null}
      {onEdit ? (
        <MessageFooterAction disabled={actionsDisabled} label={t('chat.message.edit')} onClick={onEdit}>
          <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
        </MessageFooterAction>
      ) : null}
    </>
  );

  return (
    <div className={`chat-message-footer chat-message-footer--${align}`}>
      {timePosition === 'before-actions' ? timeNode : null}
      {actionNodes}
      {timePosition === 'after-actions' ? timeNode : null}
    </div>
  );
}

function MessageFooterAction({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <ActionTooltip placement="top" title={label}>
      <button
        className={active ? 'is-copied' : ''}
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
      >
        {children}
      </button>
    </ActionTooltip>
  );
}

function formatTime(value: string, locale: AppLocale): string {
  let formatter = timeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    timeFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(value));
}
