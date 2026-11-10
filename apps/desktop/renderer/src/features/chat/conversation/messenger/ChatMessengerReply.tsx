import type { ChatDisplayItem } from '../chatMessageDisplay.js';
import { MarkdownRenderer } from '../../markdown/MarkdownRenderer.js';
import { ChatMessageAttachments } from '../ChatMessageAttachments.js';
import { ChatErrorMessage } from '../ChatErrorMessage.js';
import { messengerReplyContent, messengerReplySegments } from './chatMessengerMessages.js';

/** This surface deliberately never mounts execution, reasoning or compaction renderers. */
export function ChatMessengerReply({ item }: { item: Extract<ChatDisplayItem, { type: 'assistant' }> }) {
  return <div className="chat-messenger-reply">
    {messengerReplySegments(item).map((message) => <div key={message.id}>
      <MarkdownRenderer content={messengerReplyContent(message)} legacyThinkingTags={!message.streamParts} streaming={message.status === 'streaming'} />
      {message.attachments?.length ? <ChatMessageAttachments attachments={message.attachments} variant="assistant" /> : null}
      {message.error ? <ChatErrorMessage message={message.error} /> : null}
    </div>)}
    {item.toolAttachments?.length ? <ChatMessageAttachments attachments={item.toolAttachments} variant="assistant" /> : null}
  </div>;
}
