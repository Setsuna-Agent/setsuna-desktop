import {
  isRuntimeInlineMessageAttachment,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessage,
} from '@setsuna-desktop/contracts';
import { portableRuntimeAssistantText } from '../../utils/runtime-message-semantic-fingerprint.js';

export const portableAssistantText = portableRuntimeAssistantText;

export function systemText(messages: RuntimeMessage[]): string {
  return instructionText(messages, new Set(['system']));
}

export function inlineImageAttachments(message: RuntimeMessage): RuntimeInlineMessageAttachment[] {
  return (message.attachments ?? []).filter(
    (attachment): attachment is RuntimeInlineMessageAttachment =>
      isRuntimeInlineMessageAttachment(attachment)
      && attachment.modelVisible !== false
      && attachment.type.startsWith('image/'),
  );
}

export function toolVisualMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    role: 'user',
    content: `Image output from tool ${message.toolName || 'tool'}:`,
  };
}

function instructionText(messages: RuntimeMessage[], roles: ReadonlySet<RuntimeMessage['role']>): string {
  return messages
    .filter((message) => message.visibility !== 'transcript' && roles.has(message.role) && message.content.trim())
    .map((message) => message.content.trim())
    .join('\n\n');
}
