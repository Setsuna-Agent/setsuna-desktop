import {
  isRuntimeGeneratedMessageAttachment,
  type ModelRequest,
  type RuntimeGeneratedMessageAttachment,
  type RuntimeMessage,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import type { GeneratedImageReader } from '../../ports/generated-image-store.js';
import type { ModelClient, ModelCompactionRequest } from '../../ports/model-client.js';

const IMAGE_INPUT_FALLBACK_MESSAGE = [
  'The runtime has already handled any user-facing disclosure for unavailable image inputs.',
  'Do not mention, restate, translate, or repeat an image-input failure or fallback notice.',
  'Continue using only evidence still present in this request, and do not claim unavailable images were visually verified.',
].join(' ');
const IMAGE_INPUT_FALLBACK_NOTICE_MARKER = '图片视觉检查未能完成：模型供应商拒绝了图片输入。';
const IMAGE_INPUT_FALLBACK_NOTICE = `${IMAGE_INPUT_FALLBACK_NOTICE_MARKER}本轮将跳过视觉检查，并基于其余文本和工具结果继续。\n\n`;

/** Resolves opaque, model-visible image assets only for the lifetime of a provider request. */
export class ImageAssetResolvingModelClient implements ModelClient {
  constructor(
    private readonly inner: ModelClient,
    private readonly imageStore: GeneratedImageReader,
  ) {}

  async *stream(request: ModelRequest) {
    const preparedRequest = prepareRequestAfterImageFallback(request);
    const resolvedRequest = {
      ...preparedRequest,
      messages: await this.resolveMessages(preparedRequest.messages),
    };
    let emitted = false;
    try {
      for await (const event of this.inner.stream(resolvedRequest)) {
        emitted = true;
        yield event;
      }
    } catch (error) {
      if (emitted || !hasModelVisibleImages(resolvedRequest.messages) || !isRejectedImageInputError(error)) throw error;
      // Main-turn requests carry a step snapshot. Emit a deterministic disclosure instead of
      // relying on the fallback model to remember to mention the rejected visual inspection.
      if (request.stepSnapshot) yield { type: 'text_delta' as const, text: IMAGE_INPUT_FALLBACK_NOTICE };
      yield* this.inner.stream(withoutModelVisibleImages(resolvedRequest));
    }
  }

  async compactConversation(request: ModelCompactionRequest) {
    if (!this.inner.compactConversation) {
      throw new Error('Remote context compaction is not supported by the configured model client.');
    }
    const preparedRequest = prepareRequestAfterImageFallback(request);
    const resolvedRequest = {
      ...preparedRequest,
      messages: await this.resolveMessages(preparedRequest.messages),
    };
    try {
      return await this.inner.compactConversation(resolvedRequest);
    } catch (error) {
      if (!hasModelVisibleImages(resolvedRequest.messages) || !isRejectedImageInputError(error)) throw error;
      return this.inner.compactConversation(withoutModelVisibleImages(resolvedRequest));
    }
  }

  private async resolveMessages(messages: RuntimeMessage[]): Promise<RuntimeMessage[]> {
    return Promise.all(messages.map(async (message) => {
      if (!message.attachments?.some(needsModelAssetResolution)) return message;
      const attachments = await Promise.all(message.attachments.map((attachment) => (
        this.resolveAttachment(attachment)
      )));
      return { ...message, attachments };
    }));
  }

  private async resolveAttachment(attachment: RuntimeMessageAttachment): Promise<RuntimeMessageAttachment> {
    if (!needsModelAssetResolution(attachment)) return attachment;
    const asset = await this.imageStore.read(attachment.assetId);
    return {
      id: attachment.id,
      name: attachment.name,
      type: asset.type,
      size: asset.data.byteLength,
      modelVisible: true,
      url: `data:${asset.type};base64,${Buffer.from(asset.data).toString('base64')}`,
    };
  }
}

function withoutModelVisibleImages<T extends ModelRequest | ModelCompactionRequest>(request: T): T {
  return withoutMatchingModelVisibleImages(request, () => true);
}

function prepareRequestAfterImageFallback<T extends ModelRequest | ModelCompactionRequest>(request: T): T {
  const noticeIndex = findLatestFallbackNoticeIndex(request.messages);
  if (noticeIndex < 0) return request;
  const currentTurnId = 'stepSnapshot' in request ? request.stepSnapshot?.turnId : undefined;
  const fallbackOccurredInCurrentTurn = Boolean(currentTurnId && request.messages.some((message) => (
    message.turnId === currentTurnId && isImageFallbackNoticeMessage(message)
  )));

  // Keep the disclosure in the persisted transcript, but never feed it back to the model.
  // Otherwise a provider can imitate every historical copy on each following tool step.
  const messages = request.messages.flatMap((message, messageIndex): RuntimeMessage[] => {
    const content = isImageFallbackNoticeMessage(message)
      ? stripImageFallbackNotices(message.content)
      : message.content;
    const attachments = message.attachments?.filter((attachment) => !(
      isModelVisibleImage(attachment)
      && (fallbackOccurredInCurrentTurn || messageIndex < noticeIndex)
    ));
    if (!content && !message.toolCalls?.length && !attachments?.length) return [];
    if (content === message.content && attachments?.length === message.attachments?.length) return [message];
    return [{
      ...message,
      content,
      attachments: attachments?.length ? attachments : undefined,
    }];
  });
  return withImageInputFallbackMessage({ ...request, messages });
}

function withoutMatchingModelVisibleImages<T extends ModelRequest | ModelCompactionRequest>(
  request: T,
  shouldRemove: (attachment: RuntimeMessageAttachment, messageIndex: number) => boolean,
): T {
  let removed = false;
  const messages = request.messages.map((message, messageIndex) => {
    const attachments = message.attachments?.filter((attachment) => {
      if (!isModelVisibleImage(attachment) || !shouldRemove(attachment, messageIndex)) return true;
      removed = true;
      return false;
    });
    if (attachments?.length === message.attachments?.length) return message;
    return { ...message, attachments: attachments?.length ? attachments : undefined };
  });
  if (!removed) return request;
  return withImageInputFallbackMessage({ ...request, messages });
}

function withImageInputFallbackMessage<T extends ModelRequest | ModelCompactionRequest>(request: T): T {
  if (request.messages.some((message) => message.id === 'runtime_image_input_fallback')) return request;
  const messages = [...request.messages];
  const firstConversationIndex = messages.findIndex((message) => message.role !== 'system' && message.role !== 'developer');
  const insertionIndex = firstConversationIndex < 0 ? messages.length : firstConversationIndex;
  const referenceMessage = messages[insertionIndex] ?? messages.at(-1);
  messages.splice(insertionIndex, 0, {
    id: 'runtime_image_input_fallback',
    turnId: referenceMessage?.turnId,
    role: 'developer',
    promptSource: 'runtime_context',
    content: IMAGE_INPUT_FALLBACK_MESSAGE,
    createdAt: referenceMessage?.createdAt ?? '1970-01-01T00:00:00.000Z',
    status: 'complete',
    visibility: 'model',
  });
  return { ...request, messages };
}

function findLatestFallbackNoticeIndex(messages: RuntimeMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isImageFallbackNoticeMessage(message)) return index;
  }
  return -1;
}

function isImageFallbackNoticeMessage(message: RuntimeMessage): boolean {
  return message.role === 'assistant' && message.content.includes(IMAGE_INPUT_FALLBACK_NOTICE_MARKER);
}

function stripImageFallbackNotices(content: string): string {
  return content
    .split(IMAGE_INPUT_FALLBACK_NOTICE.trim())
    .join('')
    .replace(/^\s+/, '')
    .replace(/\n{3,}/g, '\n\n');
}

function hasModelVisibleImages(messages: RuntimeMessage[]): boolean {
  return messages.some((message) => message.attachments?.some(isModelVisibleImage));
}

function isModelVisibleImage(attachment: RuntimeMessageAttachment): boolean {
  return attachment.type.startsWith('image/') && attachment.modelVisible !== false;
}

function isRejectedImageInputError(error: unknown): boolean {
  const details = collectErrorDetails(error).toLowerCase();
  if (!details.includes('image')) return false;
  return details.includes('new_sensitive')
    || details.includes('image is sensitive')
    || (details.includes('image input') && /\b(?:unsafe|moderation|rejected|not allowed|sensitive)\b/.test(details));
}

function collectErrorDetails(value: unknown, seen = new Set<object>(), depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const record = value as Record<string, unknown>;
  return ['name', 'message', 'responseBody', 'data', 'error', 'cause']
    .map((key) => collectErrorDetails(record[key], seen, depth + 1))
    .filter(Boolean)
    .join(' ');
}

function needsModelAssetResolution(
  attachment: RuntimeMessageAttachment,
): attachment is RuntimeGeneratedMessageAttachment {
  // Managed generated images predate model-visible assets and may omit the flag.
  // Only tool images explicitly marked true are eligible for provider hydration.
  return isRuntimeGeneratedMessageAttachment(attachment) && attachment.modelVisible === true;
}
