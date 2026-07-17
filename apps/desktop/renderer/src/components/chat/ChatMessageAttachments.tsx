import { isRuntimeInlineMessageAttachment, type RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { WorkspaceFileIcon } from '../workspace/WorkspaceFileIcon.js';
import { formatAttachmentTypeLabel } from './chatAttachments.js';

export function ChatMessageAttachments({
  attachments,
  variant = 'user',
}: {
  attachments: RuntimeMessageAttachment[];
  variant?: 'user' | 'assistant';
}) {
  return (
    <div className={`chat-user-message-attachments chat-user-message-attachments--${variant}`} aria-label="消息附件">
      {attachments.map((attachment) => (
        isRuntimeInlineMessageAttachment(attachment) && attachment.type.startsWith('image/') ? (
          <img key={attachment.id} src={attachment.url} alt={attachment.name} title={attachment.name} />
        ) : (
          <div className="chat-user-message-file" key={attachment.id} title={attachment.name}>
            <WorkspaceFileIcon className="chat-user-message-file__icon" path={attachment.name} type="file" />
            <span className="chat-user-message-file__copy">
              <span className="chat-user-message-file__name">{attachment.name}</span>
              <span className="chat-user-message-file__meta">{formatAttachmentTypeLabel(attachment.name, attachment.type)}</span>
            </span>
          </div>
        )
      ))}
    </div>
  );
}
