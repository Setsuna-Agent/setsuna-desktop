import {
  isRuntimeInlineMessageAttachment,
  isRuntimeRasterImageMimeType,
  isRuntimeStoredMessageAttachment,
  OPENAI_VISION_RECOGNITION_PLUGIN_ID,
  type RuntimeInlineMessageAttachment,
  type RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import type {
  VisionRecognitionLegacySettingsAdapter,
  VisionRecognitionResolvedImage,
  VisionRecognitionRuntimeHost,
  VisionRecognitionTextRequest,
  VisionRecognitionTextResult,
} from '@setsuna-desktop/feature-vision-recognition/contracts';
import type { AttachmentStore } from '../../ports/attachment-store.js';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { UsageRecorder } from '../../ports/usage-store.js';
import {
  detectSafeImageMimeType,
  MAX_IN_MEMORY_RASTER_IMAGE_BYTES,
  readSafeRasterImageFile,
  type SafeImageMimeType,
} from '../../utils/safe-image.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';

type HostDependencies = Readonly<{
  attachments: Pick<AttachmentStore, 'resolveForThread'>;
  clock: Pick<Clock, 'now'>;
  config: Pick<ConfigStore, 'getConfig'>;
  legacySettings: VisionRecognitionLegacySettingsAdapter;
  models: Pick<ModelClient, 'stream'>;
  plugins: Pick<PluginBundleStore, 'listInstalledRecords'>;
  threads: Pick<ThreadStore, 'getThread'>;
  usage: Pick<UsageRecorder, 'recordUsage'>;
}>;

/**
 * Adapts host-owned stores and model streaming to the narrow Vision Feature
 * port. Attachment ownership and safe file reads remain on the runtime side.
 */
export class DesktopVisionRecognitionRuntimeHost implements VisionRecognitionRuntimeHost {
  constructor(private readonly dependencies: HostDependencies) {}

  async listProviders() {
    return (await this.dependencies.config.getConfig()).providers;
  }

  now(): Date {
    return this.dependencies.clock.now();
  }

  async isMarketplacePluginInstalled(): Promise<boolean> {
    return (await this.dependencies.plugins.listInstalledRecords()).some((plugin) => (
      plugin.id === OPENAI_VISION_RECOGNITION_PLUGIN_ID
      && plugin.installationSource === 'marketplace'
    ));
  }

  readLegacySelection() {
    return this.dependencies.legacySettings.read();
  }

  retireLegacySelection() {
    return this.dependencies.legacySettings.retire();
  }

  async recordUsage(input: Parameters<UsageRecorder['recordUsage']>[0]): Promise<void> {
    await this.dependencies.usage.recordUsage(input);
  }

  async generateText(input: VisionRecognitionTextRequest): Promise<VisionRecognitionTextResult> {
    const collector = createModelStreamTextCollector();
    let usage: VisionRecognitionTextResult['usage'];
    let protocolUsage: VisionRecognitionTextResult['usage'];
    const { maxResultChars, ...request } = input;
    for await (const event of this.dependencies.models.stream(request)) {
      collector.consume(event);
      if (event.type === 'usage') usage = event.usage;
      if (event.type === 'token_count') protocolUsage = event.usage;
      if (collector.text().length > maxResultChars) {
        throw new Error(`Vision recognition result exceeds ${maxResultChars.toLocaleString('en-US')} characters.`);
      }
    }
    const reportedUsage = usage ?? protocolUsage;
    return Object.freeze({
      content: collector.text(),
      ...(reportedUsage ? { usage: reportedUsage } : {}),
    });
  }

  async resolveImage(threadId: string, requestedId: string): Promise<VisionRecognitionResolvedImage> {
    const thread = await this.dependencies.threads.getThread(threadId);
    if (!thread) throw new Error('当前会话不存在，无法读取图片附件。');
    const attachment = [...thread.messages]
      .reverse()
      .flatMap((message) => [...(message.attachments ?? [])].reverse())
      .find((item): item is RuntimeInlineMessageAttachment | RuntimeStoredMessageAttachment => (
        (isRuntimeInlineMessageAttachment(item) || isRuntimeStoredMessageAttachment(item))
        && (isRuntimeInlineMessageAttachment(item)
          ? item.type.startsWith('image/')
          : isRuntimeRasterImageMimeType(item.type))
        && (
          item.id === requestedId
          || (isRuntimeStoredMessageAttachment(item) && item.assetId === requestedId)
        )
      ));
    if (!attachment) throw new Error(`当前会话中没有可用的图片附件：${requestedId}`);

    if (isRuntimeInlineMessageAttachment(attachment)) {
      const inline = decodeInlineImage(attachment);
      if (!inline) throw new Error('图片附件不是受支持的 PNG、JPEG、GIF 或 WebP 文件。');
      return Object.freeze({ id: attachment.id, name: attachment.name, ...inline });
    }
    if (!isRuntimeRasterImageMimeType(attachment.type)) {
      throw new Error('图片附件不是受支持的 PNG、JPEG、GIF 或 WebP 文件。');
    }

    const resolved = (await this.dependencies.attachments.resolveForThread(threadId, [attachment]))[0];
    if (!resolved) throw new Error(`图片附件不可用或不属于当前会话：${requestedId}`);
    if (resolved.attachment.size > MAX_IN_MEMORY_RASTER_IMAGE_BYTES) {
      throw new Error('图片附件过大，无法载入视觉模型；Agent 仍可通过本地文件路径读取。');
    }
    const data = await readSafeRasterImageFile({
      filePath: resolved.absolutePath,
      expectedMimeType: attachment.type,
      expectedSize: resolved.attachment.size,
    });
    if (!data) throw new Error('图片附件不是受支持的 PNG、JPEG、GIF 或 WebP 文件。');
    return Object.freeze({
      id: attachment.assetId,
      name: attachment.name,
      mimeType: attachment.type,
      data,
    });
  }
}

function decodeInlineImage(
  attachment: RuntimeInlineMessageAttachment,
): Pick<VisionRecognitionResolvedImage, 'mimeType' | 'data'> | null {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z\d+/=\s]+)$/iu.exec(attachment.url);
  if (!match?.[1] || !match[2]) return null;
  const mimeType = match[1].toLowerCase() as SafeImageMimeType;
  const payload = match[2].replace(/\s/gu, '');
  if (
    mimeType !== attachment.type
    || attachment.size > MAX_IN_MEMORY_RASTER_IMAGE_BYTES
    || !payload.length
    || payload.length % 4 !== 0
    || payload.length > Math.ceil(MAX_IN_MEMORY_RASTER_IMAGE_BYTES / 3) * 4
  ) return null;
  const data = Buffer.from(payload, 'base64');
  if (!data.byteLength || data.byteLength !== attachment.size || data.toString('base64') !== payload) return null;
  return detectSafeImageMimeType(data) === mimeType ? { mimeType, data } : null;
}
