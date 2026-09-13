import { Button } from '@setsuna-desktop/renderer-ui';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { Check, Copy, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n, type AppLocale } from '../../../shared/i18n/I18nProvider.js';
import { copyTextToClipboard } from '../../../shared/lib/clipboard.js';
import { EditIcon } from '../../../shared/ui/EditIcon.js';
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
  const copyTimerRef = useRef<number | null>(null);
  const formattedTime = useMemo(() => formatTime(message.createdAt, locale), [locale, message.createdAt]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const copyMessage = async () => {
    if (!message.content) return;
    try {
      await copyTextToClipboard(message.content);
      setCopied(true);
      // Repeated clicks keep the confirmation visible for the latest successful copy.
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
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
        {copied
          ? <Check size={14} strokeWidth={1.8} aria-hidden="true" />
          : <Copy size={14} strokeWidth={1.8} aria-hidden="true" />}
      </MessageFooterAction>
      {onDelete ? (
        <MessageFooterAction disabled={actionsDisabled} label={t('common.delete')} onClick={onDelete}>
          <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
        </MessageFooterAction>
      ) : null}
      {onEdit ? (
        <MessageFooterAction disabled={actionsDisabled} label={t('chat.message.edit')} onClick={onEdit}>
          <EditIcon size={14} strokeWidth={1.8} aria-hidden="true" />
        </MessageFooterAction>
      ) : null}
    </>
  );

  return (
    <div className={`chat-message-footer chat-message-footer--${align}`} data-copied={copied || undefined}>
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
      <Button variant="ghost"
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
      </Button>
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
