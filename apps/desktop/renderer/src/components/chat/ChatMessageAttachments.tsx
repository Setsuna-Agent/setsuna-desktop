import {
  isRuntimeInlineMessageAttachment,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import { WorkspaceFileIcon } from '../workspace/WorkspaceFileIcon.js';
import { formatAttachmentTypeLabel } from './chatAttachments.js';
import { ChatMessageImageGallery } from './ChatMessageImageGallery.js';

export function ChatMessageAttachments({
  attachments,
  variant = 'user',
}: {
  attachments: RuntimeMessageAttachment[];
  variant?: 'user' | 'assistant';
}) {
  const imageAttachments = attachments.filter((attachment): attachment is RuntimeInlineMessageAttachment => (
    isRuntimeInlineMessageAttachment(attachment) && attachment.type.startsWith('image/')
  ));
  const fileAttachments = attachments.filter((attachment) => !imageAttachments.includes(attachment as RuntimeInlineMessageAttachment));
  return (
    <div className={`chat-user-message-attachments chat-user-message-attachments--${variant}`} aria-label="消息附件">
      <ChatMessageImageGallery attachments={imageAttachments} variant={variant} />
      {fileAttachments.map((attachment) => (
        <div className="chat-user-message-file" key={attachment.id} title={attachment.name}>
          <WorkspaceFileIcon className="chat-user-message-file__icon" path={attachment.name} type="file" />
          <span className="chat-user-message-file__copy">
            <span className="chat-user-message-file__name">{attachment.name}</span>
            <span className="chat-user-message-file__meta">{formatAttachmentTypeLabel(attachment.name, attachment.type)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
