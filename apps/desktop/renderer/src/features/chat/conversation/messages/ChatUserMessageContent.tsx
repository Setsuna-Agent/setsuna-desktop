import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { parseBrowserAnnotationMessage } from '@setsuna-desktop/feature-browser/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, ChevronUp, Goal as GoalIcon, Users } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';
import { SkillReferenceText } from '../../skills/SkillReference.js';
import { ChatMessageAttachments } from '../ChatMessageAttachments.js';
import { BrowserAnnotationReference } from '../../mentions/BrowserAnnotationReference.js';
import { useUserMessageDisclosure, userMessagePreviewHeight } from './useUserMessageDisclosure.js';

export function UserMessageContent({ message, streaming }: {
  message: RuntimeMessage;
  streaming: boolean;
}) {
  const hasSemanticKind = message.inputKind === 'goal'
    || message.inputKind === 'subagent_task';
  const annotations = parseBrowserAnnotationMessage(message.content);
  return (
    <div className={`chat-user-message-content${annotations ? ' chat-user-message-content--annotations' : ''}`}>
      {message.attachments?.length ? (
        <ChatMessageAttachments attachments={message.attachments} />
      ) : null}
      {message.content || streaming || hasSemanticKind ? (
        <div className="chat-user-message-content__text">
          <UserMessageKindBadge kind={message.inputKind} />
          {message.content || streaming ? (
            <UserMessageBody key={message.id}>
              {annotations ? <BrowserAnnotationReference message={annotations} />
                : <SkillReferenceText content={message.content || '...'} skillReferences={message.skillReferences} />}
            </UserMessageBody>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UserMessageBody({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const id = useId();
  const { collapsed, contentRef, handleFocus, showToggle, toggle, viewportRef } = useUserMessageDisclosure();
  const Icon = collapsed ? ChevronDown : ChevronUp;

  return (
    <>
      <span
        className={`chat-user-message-content__viewport${collapsed && showToggle ? ' is-collapsed' : ''}`}
        id={id}
        ref={viewportRef}
        style={collapsed ? { maxHeight: userMessagePreviewHeight, overflow: 'clip' } : undefined}
        onFocusCapture={handleFocus}
      >
        <span className="chat-user-message-content__body" ref={contentRef}>{children}</span>
      </span>
      {showToggle ? (
        <Button
          variant="ghost"
          size="small"
          className="chat-user-message-content__toggle"
          aria-controls={id}
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          {t(collapsed ? 'chat.message.expand' : 'chat.message.collapse')}
          <Icon size={14} aria-hidden="true" />
        </Button>
      ) : null}
    </>
  );
}

function UserMessageKindBadge({ kind }: { kind: RuntimeMessage['inputKind'] }) {
  const { t } = useI18n();
  if (kind !== 'goal' && kind !== 'subagent_task') return null;
  const label = t(kind === 'goal' ? 'chat.message.kind.goal' : 'chat.message.kind.subagentTask');
  const Icon = kind === 'goal' ? GoalIcon : Users;
  return (
    <span className={`chat-user-message-kind chat-user-message-kind--${kind}`} aria-label={label}>
      <Icon size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
