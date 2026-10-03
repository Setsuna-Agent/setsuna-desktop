import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { parseBrowserAnnotationMessage } from '@setsuna-desktop/feature-browser/contracts';
import { Goal as GoalIcon, ShieldCheck, Users } from 'lucide-react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';
import { SkillReferenceText } from '../../skills/SkillReference.js';
import { ChatMessageAttachments } from '../ChatMessageAttachments.js';
import { BrowserAnnotationReference } from '../../mentions/BrowserAnnotationReference.js';

export function UserMessageContent({ message, streaming }: {
  message: RuntimeMessage;
  streaming: boolean;
}) {
  const hasSemanticKind = message.inputKind === 'goal'
    || message.inputKind === 'review'
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
            <span className="chat-user-message-content__body">
              {annotations ? <BrowserAnnotationReference message={annotations} />
                : <SkillReferenceText content={message.content || '...'} skillReferences={message.skillReferences} />}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UserMessageKindBadge({ kind }: { kind: RuntimeMessage['inputKind'] }) {
  const { t } = useI18n();
  if (kind !== 'goal' && kind !== 'review' && kind !== 'subagent_task') return null;
  const label = t(kind === 'goal'
    ? 'chat.message.kind.goal'
    : kind === 'review'
      ? 'chat.message.kind.review'
      : 'chat.message.kind.subagentTask');
  const Icon = kind === 'goal' ? GoalIcon : kind === 'review' ? ShieldCheck : Users;
  return (
    <span className={`chat-user-message-kind chat-user-message-kind--${kind}`} aria-label={label}>
      <Icon size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
