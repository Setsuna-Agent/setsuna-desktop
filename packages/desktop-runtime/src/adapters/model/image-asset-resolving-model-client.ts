import {
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  normalizeRuntimeImageCompression,
  type ModelRequest,
  type ModelDiagnosticReporter,
  type RuntimeGeneratedMessageAttachment,
  type RuntimeMessage,
  type RuntimeMessageAttachment,
  type RuntimeImageCompression,
} from '@setsuna-desktop/contracts';
import type { GeneratedImageReader } from '../../ports/generated-image-store.js';
import type { ModelClient, ModelCompactionRequest } from '../../ports/model-client.js';
import { modelErrorDetails } from './model-error-details.js';
import { ModelImageTransport } from './model-image-transport.js';

const IMAGE_INPUT_FALLBACK_MESSAGE = [
  'The runtime has already handled any user-facing disclosure for unavailable image inputs.',
  'Do not mention, restate, translate, or repeat an image-input failure or fallback notice.',
  'Continue using only evidence still present in this request, and do not claim unavailable images were visually verified.',
].join(' ');
const IMAGE_INPUT_FALLBACK_NOTICE_MARKER = '图片视觉检查未能完成：模型供应商拒绝了图片输入。';
const IMAGE_INPUT_FALLBACK_NOTICE = `${IMAGE_INPUT_FALLBACK_NOTICE_MARKER}本轮将跳过视觉检查，并基于其余文本和工具结果继续。\n\n`;

/** Resolves opaque, model-visible image assets only for the lifetime of a provider request. */
export class ImageAssetResolvingModelClient implements ModelClient {
  private readonly imageTransport = new ModelImageTransport();
  private readonly originalImageProviders = new Set<string>();
  constructor(
    private readonly inner: ModelClient,
    private readonly imageStore: GeneratedImageReader,
    private readonly options: {
      reportDiagnostic?: ModelDiagnosticReporter;
      getImageCompression?: () => Promise<RuntimeImageCompression | undefined>;
    } = {},
  ) {}

  async *stream(request: ModelRequest) {
    const preparedRequest = prepareRequestAfterImageFallback(request);
    let resolvedRequest = await this.resolveRequest(preparedRequest);
    let emitted = false;
    for (;;) {
      try {
        for await (const event of this.inner.stream(resolvedRequest)) {
          emitted = true;
          yield event;
        }
        return;
      } catch (error) {
        if (!emitted && this.retryOriginalImages(preparedRequest, resolvedRequest, error)) {
          resolvedRequest = await this.resolveRequest(preparedRequest);
          continue;
        }
        if (emitted || !hasModelVisibleImages(resolvedRequest.messages) || !isRejectedImageInputError(error)) throw error;
        // Main-turn requests carry a step snapshot. Emit a deterministic disclosure instead of
        // relying on the fallback model to remember to mention the rejected visual inspection.
        if (request.stepSnapshot) yield { type: 'text_delta' as const, text: IMAGE_INPUT_FALLBACK_NOTICE };
        yield* this.inner.stream(withoutModelVisibleImages(resolvedRequest));
        return;
      }
    }
  }

  async compactConversation(request: ModelCompactionRequest) {
    if (!this.inner.compactConversation) {
      throw new Error('Remote context compaction is not supported by the configured model client.');
    }
    const preparedRequest = prepareRequestAfterImageFallback(request);
    let resolvedRequest = await this.resolveRequest(preparedRequest);
    for (;;) {
      try {
        return await this.inner.compactConversation(resolvedRequest);
      } catch (error) {
        if (this.retryOriginalImages(preparedRequest, resolvedRequest, error)) {
          resolvedRequest = await this.resolveRequest(preparedRequest);
          continue;
        }
        if (!hasModelVisibleImages(resolvedRequest.messages) || !isRejectedImageInputError(error)) throw error;
        return this.inner.compactConversation(withoutModelVisibleImages(resolvedRequest));
      }
    }
  }

  private async resolveRequest<T extends ModelRequest | ModelCompactionRequest>(request: T): Promise<T> {
    const started = performance.now();
    const snapshot = 'stepSnapshot' in request ? request.stepSnapshot : undefined;
    const record = (phase: string) => {
      try {
        this.options.reportDiagnostic?.({
          phase, threadId: snapshot?.threadId ?? request.sessionId, turnId: snapshot?.turnId,
          stepSeq: snapshot?.threadLastSeq, providerId: request.providerId, model: request.model,
          elapsedMs: Math.round(performance.now() - started), messageCount: request.messages.length,
          imageCount: request.messages.reduce((count, message) => count
            + (message.attachments?.filter(isModelVisibleImage).length ?? 0), 0),
        });
      } catch { /* Diagnostics cannot interrupt image preparation. */ }
    };
    record('images.started');
    try {
      // Read once per sampling request so all its images use the same level, while
      // later tool steps pick up saved changes without restarting the runtime.
      const compression = !hasModelVisibleImages(request.messages) || this.originalImageProviders.has(imageProviderKey(request))
        ? 'original' : normalizeRuntimeImageCompression(await this.options.getImageCompression?.());
      const messages = await this.resolveMessages(request.messages, request.signal, compression);
      record('images.ready');
      return { ...request, messages };
    } catch (error) {
      record('images.failed');
      throw error;
    }
  }

  private retryOriginalImages(request: ModelRequest | ModelCompactionRequest, resolved: ModelRequest | ModelCompactionRequest, error: unknown): boolean {
    if (request.signal?.aborted || this.originalImageProviders.has(imageProviderKey(request))) return false;
    const details = modelErrorDetails(error).toLowerCase();
    if (!details.includes('webp') || !/unsupported|not supported|does not support|not allowed|invalid.*(?:format|mime|media.type)/u.test(details)) return false;
    const changed = resolved.messages.some((message, index) => message.attachments?.some((attachment, attachmentIndex) => (
      attachment.type === 'image/webp' && request.messages[index]?.attachments?.[attachmentIndex]?.type === 'image/png'
    )));
    if (!changed) return false;
    // Some compatible endpoints accept fewer formats than their protocol. Retry
    // only explicit format rejection, preserving the complete original image.
    this.originalImageProviders.add(imageProviderKey(request));
    if (this.originalImageProviders.size > 64) this.originalImageProviders.delete(this.originalImageProviders.values().next().value!);
    return true;
  }

  private async resolveMessages(messages: RuntimeMessage[], signal: AbortSignal | undefined, compression: RuntimeImageCompression): Promise<RuntimeMessage[]> {
    const resolved: RuntimeMessage[] = [];
    // Decode at most one history image per request at a time. A long screenshot
    // history must not allocate every full-resolution pixel buffer concurrently.
    for (const message of messages) {
      signal?.throwIfAborted();
      if (message.visibility === 'transcript' || !message.attachments?.some(needsImagePreparation)) {
        resolved.push(message);
        continue;
      }
      const attachments: RuntimeMessageAttachment[] = [];
      for (const attachment of message.attachments) {
        signal?.throwIfAborted();
        attachments.push(await this.resolveAttachment(attachment, compression));
      }
      resolved.push({ ...message, attachments });
    }
    signal?.throwIfAborted();
    return resolved;
  }

  private async resolveAttachment(attachment: RuntimeMessageAttachment, compression: RuntimeImageCompression): Promise<RuntimeMessageAttachment> {
    if (!needsImagePreparation(attachment)) return attachment;
    if (compression === 'original' && isRuntimeInlineMessageAttachment(attachment)) return attachment;
    const asset = needsModelAssetResolution(attachment)
      ? await this.imageStore.read(attachment.assetId)
      : inlinePngData(attachment);
    if (!asset) return attachment;
    const data = Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data);
    const image = await this.imageTransport.prepare(data, asset.type, compression);
    if (isRuntimeInlineMessageAttachment(attachment) && image.data === data) return attachment;
    return {
      id: attachment.id,
      name: attachment.name,
      type: image.type,
      size: image.data.byteLength,
      modelVisible: true,
      url: `data:${image.type};base64,${image.data.toString('base64')}`,
    };
  }
}

function imageProviderKey(request: ModelRequest | ModelCompactionRequest): string {
  return JSON.stringify([request.providerId, request.model]);
}

function needsImagePreparation(attachment: RuntimeMessageAttachment): boolean {
  return needsModelAssetResolution(attachment)
    || (isRuntimeInlineMessageAttachment(attachment)
      && attachment.modelVisible !== false && attachment.type === 'image/png');
}

function inlinePngData(attachment: RuntimeMessageAttachment): { data: Buffer; type: string } | null {
  if (!isRuntimeInlineMessageAttachment(attachment)) return null;
  const prefix = 'data:image/png;base64,';
  if (!attachment.url.startsWith(prefix)) return null;
  return { data: Buffer.from(attachment.url.slice(prefix.length), 'base64'), type: attachment.type };
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
  const details = modelErrorDetails(error).toLowerCase();
  if (!details.includes('image')) return false;
  return details.includes('new_sensitive')
    || details.includes('image is sensitive')
    || (details.includes('image input') && /\b(?:unsafe|moderation|rejected|not allowed|sensitive)\b/.test(details));
}

function needsModelAssetResolution(
  attachment: RuntimeMessageAttachment,
): attachment is RuntimeGeneratedMessageAttachment {
  // Managed generated images predate model-visible assets and may omit the flag.
  // Only tool images explicitly marked true are eligible for provider hydration.
  return isRuntimeGeneratedMessageAttachment(attachment) && attachment.modelVisible === true;
}
