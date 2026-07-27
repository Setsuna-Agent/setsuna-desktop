import type { RuntimeMessage, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { compatibleOpenAiResponsesItems } from './openai-responses-provider-metadata.js';
import {
  inlineImageAttachments,
  portableAssistantText,
  toolVisualMessage,
} from './provider-message-content.js';
import type { ProviderReplayContext } from './provider-replay-context.js';

export function toOpenAiMessages(messages: RuntimeMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const pendingToolVisuals: RuntimeMessage[] = [];
  const flushToolVisuals = () => {
    for (const message of pendingToolVisuals.splice(0, pendingToolVisuals.length)) {
      output.push({ role: 'user', content: openAiChatContentParts(toolVisualMessage(message)) });
    }
  };
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role !== 'tool') flushToolVisuals();
    if (message.role === 'system' || message.role === 'developer' || message.role === 'user' || message.role === 'assistant') {
      output.push({
        role: message.role,
        content: message.role === 'user' && inlineImageAttachments(message).length
          ? openAiChatContentParts(message)
          : message.content || (message.toolCalls?.length ? null : ''),
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              })),
            }
          : {}),
      });
    } else if (message.role === 'tool') {
      output.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: message.content,
      });
      if (inlineImageAttachments(message).length) pendingToolVisuals.push(message);
    }
  }
  flushToolVisuals();
  return output;
}

export function toOpenAiResponsesInput(
  messages: RuntimeMessage[],
  replayContext: ProviderReplayContext,
): unknown[] {
  const output: unknown[] = [];
  const toolOutputsByCallId = openAiResponsesToolOutputsByCallId(messages);
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    const nativeItems = compatibleOpenAiResponsesItems(message, replayContext);
    if (nativeItems) {
      output.push(...nativeItems);
      for (const item of nativeItems) {
        if (item.type !== 'function_call' || typeof item.call_id !== 'string') continue;
        const toolOutput = toolOutputsByCallId.get(item.call_id);
        if (toolOutput) output.push(toolOutput);
      }
      continue;
    }
    if (message.role === 'developer') {
      output.push({ role: 'developer', content: message.content });
    } else if (message.role === 'user') {
      output.push({ role: 'user', content: openAiResponsesContentParts(message) });
    } else if (message.role === 'assistant') {
      const assistantText = portableAssistantText(message.content);
      if (assistantText) output.push({ role: 'assistant', content: assistantText });
      for (const toolCall of message.toolCalls ?? []) {
        output.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
        const toolOutput = toolOutputsByCallId.get(toolCall.id);
        if (toolOutput) output.push(toolOutput);
      }
    } else if (message.role === 'tool' && inlineImageAttachments(message).length) {
      output.push({ role: 'user', content: openAiResponsesContentParts(toolVisualMessage(message)) });
    }
  }
  return output;
}

export function toOpenAiResponsesTools(tools: RuntimeToolDefinition[] = []): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

function openAiResponsesToolOutputsByCallId(messages: RuntimeMessage[]): Map<string, unknown> {
  const outputTextByCallId = new Map<string, string[]>();
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role !== 'tool' || !message.toolCallId) continue;
    const outputs = outputTextByCallId.get(message.toolCallId) ?? [];
    outputs.push(message.content);
    outputTextByCallId.set(message.toolCallId, outputs);
  }
  return new Map([...outputTextByCallId].map(([callId, outputs]) => [
    callId,
    {
      type: 'function_call_output',
      call_id: callId,
      output: outputs.join('\n\n'),
    },
  ]));
}

function openAiChatContentParts(message: RuntimeMessage): unknown[] {
  return [
    ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
    ...inlineImageAttachments(message).map((attachment) => ({
      type: 'image_url',
      image_url: { url: attachment.url },
    })),
  ];
}

function openAiResponsesContentParts(message: RuntimeMessage): unknown {
  const attachments = inlineImageAttachments(message);
  if (!attachments.length) return message.content;
  return [
    ...(message.content.trim() ? [{ type: 'input_text', text: message.content }] : []),
    ...attachments.map((attachment) => ({
      type: 'input_image',
      image_url: attachment.url,
    })),
  ];
}
