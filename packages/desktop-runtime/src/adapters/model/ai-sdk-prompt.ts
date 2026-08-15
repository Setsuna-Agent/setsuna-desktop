import {
  isRuntimeInlineMessageAttachment,
  type ModelRequest,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessage,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import {
  jsonSchema,
  type AssistantContent,
  type ModelMessage,
  type ToolChoice,
  type ToolSet,
  type UserContent,
} from 'ai';
import { portableAssistantText } from './provider-message-content.js';

export type AiSdkPromptOptions = {
  assistantContent?: (message: RuntimeMessage) => AssistantContent;
  toolMessage?: (message: RuntimeMessage) => ModelMessage | null;
  appendToolVisuals?: boolean;
};

export function toAiSdkMessages(
  messages: RuntimeMessage[],
  options: AiSdkPromptOptions = {},
): ModelMessage[] {
  const output: ModelMessage[] = [];
  const pendingToolVisuals: RuntimeMessage[] = [];
  const appendToolVisuals = options.appendToolVisuals !== false;
  const flushToolVisuals = () => {
    for (const message of pendingToolVisuals.splice(0, pendingToolVisuals.length)) {
      output.push({ role: 'user', content: toAiSdkUserContent(toolVisualMessage(message)) });
    }
  };

  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role !== 'tool') flushToolVisuals();
    if (message.role === 'system' || message.role === 'developer') {
      continue;
    }
    if (message.role === 'user') {
      output.push({ role: 'user', content: toAiSdkUserContent(message) });
      continue;
    }
    if (message.role === 'assistant') {
      output.push({
        role: 'assistant',
        content: options.assistantContent?.(message) ?? defaultAssistantContent(message),
      });
      continue;
    }
    if (message.role !== 'tool' || !message.toolCallId) continue;
    const toolMessage = options.toolMessage?.(message) ?? defaultToolMessage(message);
    if (toolMessage) output.push(toolMessage);
    if (appendToolVisuals && aiSdkInlineAttachments(message).length) pendingToolVisuals.push(message);
  }
  flushToolVisuals();
  return output;
}

export function toAiSdkInstructions(messages: RuntimeMessage[]): string | undefined {
  const instructions = messages
    .filter((message) => (
      message.visibility !== 'transcript'
      && (message.role === 'system' || message.role === 'developer')
      && message.content.trim()
    ))
    .map((message) => message.content.trim())
    .join('\n\n');
  return instructions || undefined;
}

export function toAiSdkUserContent(message: RuntimeMessage): UserContent {
  const attachments = aiSdkInlineAttachments(message);
  if (!attachments.length) return message.content;
  return [
    ...(message.content.trim() ? [{ type: 'text' as const, text: message.content }] : []),
    ...attachments.map(aiSdkFilePart),
  ];
}

export function aiSdkInlineAttachments(message: RuntimeMessage): RuntimeInlineMessageAttachment[] {
  return (message.attachments ?? []).filter(
    (attachment): attachment is RuntimeInlineMessageAttachment => (
      isRuntimeInlineMessageAttachment(attachment)
      && attachment.modelVisible !== false
      && attachment.type.startsWith('image/')
    ),
  );
}

export function aiSdkFilePart(attachment: RuntimeInlineMessageAttachment) {
  const data = parseAiSdkDataUrl(attachment.url);
  return {
    type: 'file' as const,
    filename: attachment.name || undefined,
    mediaType: attachment.type || 'application/octet-stream',
    data: data
      ? { type: 'data' as const, data: data.base64 }
      : { type: 'url' as const, url: new URL(attachment.url) },
  };
}

export function toAiSdkTools(tools: RuntimeToolDefinition[] | undefined): ToolSet | undefined {
  if (!tools?.length) return undefined;
  const output: ToolSet = {};
  for (const item of tools) {
    output[item.name] = {
      description: item.description,
      inputSchema: jsonSchema(item.inputSchema as Parameters<typeof jsonSchema>[0]),
    };
  }
  return output;
}

export function toAiSdkToolChoice(toolChoice: ModelRequest['toolChoice']): ToolChoice<ToolSet> | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === 'auto' || toolChoice === 'none') return toolChoice;
  return { type: 'tool', toolName: toolChoice.name };
}

export function parseAiSdkToolInput(argumentsText: string): unknown {
  if (!argumentsText.trim()) return {};
  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return {};
  }
}

function defaultAssistantContent(message: RuntimeMessage): AssistantContent {
  // Current messages keep reasoning in structured stream parts. Strip the deprecated tag-based
  // encoding as well so historical transcripts cannot replay private reasoning to providers.
  const assistantText = portableAssistantText(message.content);
  if (!message.toolCalls?.length) return assistantText;
  return [
    ...(assistantText.trim() ? [{ type: 'text' as const, text: assistantText }] : []),
    ...message.toolCalls.map((toolCall) => ({
      type: 'tool-call' as const,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: parseAiSdkToolInput(toolCall.arguments),
    })),
  ];
}

function defaultToolMessage(message: RuntimeMessage): ModelMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: message.toolCallId!,
      toolName: message.toolName || 'tool',
      output: { type: 'text', value: message.content },
    }],
  };
}

function toolVisualMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    role: 'user',
    content: `Image output from tool ${message.toolName || 'tool'}:`,
  };
}

function parseAiSdkDataUrl(value: string): { mediaType: string; base64: string } | null {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}
