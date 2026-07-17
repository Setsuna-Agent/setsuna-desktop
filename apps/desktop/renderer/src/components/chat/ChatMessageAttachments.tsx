import { FileText } from 'lucide-react';
import { isRuntimeInlineMessageAttachment, type RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { formatAttachmentSize } from './chatAttachments.js';

export function ChatMessageAttachments({ attachments }: { attachments: RuntimeMessageAttachment[] }) {
  return (
    <div className="chat-user-message-attachments" aria-label="消息附件">
      {attachments.map((attachment) => (
        isRuntimeInlineMessageAttachment(attachment) && attachment.type.startsWith('image/') ? (
          <img key={attachment.id} src={attachment.url} alt={attachment.name} title={attachment.name} />
        ) : (
          <div className="chat-user-message-file" key={attachment.id} title={attachment.name}>
            <FileText size={17} aria-hidden="true" />
            <span className="chat-user-message-file__copy">
              <span className="chat-user-message-file__name">{attachment.name}</span>
              <span className="chat-user-message-file__meta">{formatAttachmentSize(attachment.size)}</span>
            </span>
          </div>
        )
      ))}
    </div>
  );
}

