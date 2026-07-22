import {
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  type RuntimeGeneratedMessageAttachment,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceFileIcon } from '../../workspace/WorkspaceFileIcon.js';
import { formatAttachmentTypeLabel } from '../composer/chatAttachments.js';
import { ChatMessageImageGallery } from './ChatMessageImageGallery.js';

export function ChatMessageAttachments({
  attachments,
  variant = 'user',
}: {
  attachments: RuntimeMessageAttachment[];
  variant?: 'user' | 'assistant';
}) {
  const { t } = useI18n();
  const imageAttachments = attachments.filter((attachment): attachment is RuntimeGeneratedMessageAttachment | RuntimeInlineMessageAttachment => (
    attachment.type.startsWith('image/')
    && (isRuntimeGeneratedMessageAttachment(attachment) || isRuntimeInlineMessageAttachment(attachment))
  ));
  const imageAttachmentIds = new Set(imageAttachments.map((attachment) => attachment.id));
  const fileAttachments = attachments.filter((attachment) => !imageAttachmentIds.has(attachment.id));
  return (
    <div className={`chat-user-message-attachments chat-user-message-attachments--${variant}`} aria-label={t('chat.message.attachments')}>
      <ChatMessageImageGallery attachments={imageAttachments} variant={variant} />
      {fileAttachments.map((attachment) => (
        <div className="chat-user-message-file" key={attachment.id} title={attachment.name}>
          <WorkspaceFileIcon className="chat-user-message-file__icon" path={attachment.name} type="file" />
          <span className="chat-user-message-file__copy">
            <span className="chat-user-message-file__name">{attachment.name}</span>
            <span className="chat-user-message-file__meta">{formatAttachmentTypeLabel(attachment.name, attachment.type, t)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
