import {
  isRuntimeGeneratedMessageAttachment,
  type ModelRequest,
  type RuntimeGeneratedMessageAttachment,
  type RuntimeMessage,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import type { GeneratedImageReader } from '../../ports/generated-image-store.js';
import type { ModelClient, ModelCompactionRequest } from '../../ports/model-client.js';

/** Resolves opaque, model-visible image assets only for the lifetime of a provider request. */
export class ImageAssetResolvingModelClient implements ModelClient {
  constructor(
    private readonly inner: ModelClient,
    private readonly imageStore: GeneratedImageReader,
  ) {}

  async *stream(request: ModelRequest) {
    yield* this.inner.stream({
      ...request,
      messages: await this.resolveMessages(request.messages),
    });
  }

  async compactConversation(request: ModelCompactionRequest) {
    if (!this.inner.compactConversation) {
      throw new Error('Remote context compaction is not supported by the configured model client.');
    }
    return this.inner.compactConversation({
      ...request,
      messages: await this.resolveMessages(request.messages),
    });
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

function needsModelAssetResolution(
  attachment: RuntimeMessageAttachment,
): attachment is RuntimeGeneratedMessageAttachment {
  // Managed generated images predate model-visible assets and may omit the flag.
  // Only tool images explicitly marked true are eligible for provider hydration.
  return isRuntimeGeneratedMessageAttachment(attachment) && attachment.modelVisible === true;
}
