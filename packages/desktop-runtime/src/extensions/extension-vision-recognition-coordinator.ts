import {
  isRuntimeInlineMessageAttachment,
  isRuntimeRasterImageMimeType,
  isRuntimeStoredMessageAttachment,
  RUNTIME_VISION_RECOGNITION_PROMPT_MAX_CHARS,
  type ProviderConfigState,
  type ProviderModelConfig,
  type RuntimeConfiguredModelReference,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessage,
  type RuntimeStoredMessageAttachment,
  type RuntimeUsage,
  type RuntimeVisionRecognitionTestInput,
  type RuntimeVisionRecognitionTestResult,
} from '@setsuna-desktop/contracts';
import { readFile } from 'node:fs/promises';
import type { AttachmentStore } from '../ports/attachment-store.js';
import type { Clock } from '../ports/clock.js';
import type { ConfigStore } from '../ports/config-store.js';
import type { ModelClient } from '../ports/model-client.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { UsageStore } from '../ports/usage-store.js';
import type { ToolExecutionContext } from '../ports/tool-host.js';
import { detectSafeImageMimeType, type SafeImageMimeType } from '../utils/safe-image.js';
import { createModelStreamTextCollector } from '../utils/model-stream-text-collector.js';
import { objectInput, requiredStringArg } from '../adapters/tool/tool-input.js';

const MAX_RESULT_CHARS = 64_000;
const MAX_OUTPUT_TOKENS = 4_096;
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

type VisionRecognitionConfigStore = Pick<ConfigStore, 'getConfig'>;
type VisionRecognitionThreadStore = Pick<ThreadStore, 'getThread'>;
type VisionRecognitionAttachmentStore = Pick<AttachmentStore, 'resolveForThread'>;
type VisionRecognitionModelClient = Pick<ModelClient, 'stream'>;

type ResolvedVisionImage = {
  id: string;
  name: string;
  mimeType: SafeImageMimeType;
  data: Buffer;
};

type SelectedVisionModel = {
  reference: RuntimeConfiguredModelReference;
  provider: ProviderConfigState;
  model: ProviderModelConfig;
};

type ExtensionVisionRecognitionCoordinatorOptions = {
  clock?: Pick<Clock, 'now'>;
  usageStore?: Pick<UsageStore, 'recordUsage'>;
};

export type ExtensionVisionRecognitionResult = {
  content: string;
  attachmentId: string;
  attachmentName: string;
  providerId: string;
  modelId: string;
  model: string;
};

/**
 * 为第一方扩展提供受控的视觉模型与线程附件桥。Bundle 负责工具定义和输出
 * 语义；这里复用 provider 凭据并校验附件归属，避免 worker 接触本地路径。
 */
export class ExtensionVisionRecognitionCoordinator {
  constructor(
    private readonly configStore: VisionRecognitionConfigStore,
    private readonly attachmentStore: VisionRecognitionAttachmentStore,
    private readonly threadStore: VisionRecognitionThreadStore,
    private readonly modelClient: VisionRecognitionModelClient,
    private readonly options: ExtensionVisionRecognitionCoordinatorOptions = {},
  ) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(await this.availableModel());
  }

  async testRecognition(
    input: RuntimeVisionRecognitionTestInput,
    signal?: AbortSignal,
  ): Promise<RuntimeVisionRecognitionTestResult> {
    const prompt = validatedPrompt(input.prompt);
    const selection = await this.availableModel();
    if (!selection) throw new Error('尚未选择可用的视觉模型。');
    const startedAt = Date.now();
    const content = await this.analyzeImage(selection, prompt, {
      id: 'vision_recognition_test_image',
      name: 'vision-recognition-test.png',
      mimeType: 'image/png',
      data: Buffer.from(TEST_IMAGE_BASE64, 'base64'),
    }, signal);
    return {
      content,
      durationMs: Math.max(0, Date.now() - startedAt),
      model: selection.model.code,
    };
  }

  async analyze(input: unknown, context: ToolExecutionContext): Promise<ExtensionVisionRecognitionResult> {
    const selection = await this.availableModel();
    if (!selection) throw new Error('尚未选择可用的视觉模型。');
    const args = objectInput(input);
    const attachmentId = requiredStringArg(args.attachment_id, 'attachment_id');
    const prompt = validatedPrompt(requiredStringArg(args.prompt, 'prompt'));
    const image = await this.resolveImage(context.threadId, attachmentId);
    const content = await this.analyzeImage(
      selection,
      prompt,
      image,
      context.signal,
      context.turnId ? { threadId: context.threadId, turnId: context.turnId } : undefined,
    );
    return {
      content,
      attachmentId: image.id,
      attachmentName: image.name,
      providerId: selection.reference.providerId,
      modelId: selection.reference.modelId,
      model: selection.model.code,
    };
  }

  private async analyzeImage(
    selection: SelectedVisionModel,
    prompt: string,
    image: ResolvedVisionImage,
    signal?: AbortSignal,
    usageContext?: { threadId: string; turnId: string },
  ): Promise<string> {
    const collector = createModelStreamTextCollector();
    let usage: RuntimeUsage | undefined;
    let protocolUsage: RuntimeUsage | undefined;
    for await (const event of this.modelClient.stream({
      providerId: selection.reference.providerId,
      model: selection.model.code,
      messages: [visionRequestMessage(prompt, image)],
      tools: [],
      toolChoice: 'none',
      maxOutputTokens: Math.min(selection.model.maxOutputTokens, MAX_OUTPUT_TOKENS),
      signal,
    })) {
      collector.consume(event);
      if (event.type === 'usage') usage = event.usage;
      if (event.type === 'token_count') protocolUsage = event.usage;
      if (collector.text().length > MAX_RESULT_CHARS) {
        throw new Error(`视觉识别结果超过 ${MAX_RESULT_CHARS.toLocaleString('en-US')} 字符限制。`);
      }
    }
    const reportedUsage = usage ?? protocolUsage;
    if (reportedUsage && usageContext) {
      await this.options.usageStore?.recordUsage({
        ...reportedUsage,
        threadId: usageContext.threadId,
        turnId: usageContext.turnId,
        createdAt: (this.options.clock?.now() ?? new Date()).toISOString(),
        providerId: reportedUsage.providerId ?? selection.reference.providerId,
        provider: reportedUsage.provider ?? selection.provider.name,
        model: reportedUsage.model ?? selection.model.code,
      });
    }
    const content = collector.text().trim();
    if (!content) throw new Error('视觉模型没有返回可用文本。');
    return content;
  }

  private async resolveImage(threadId: string, requestedId: string): Promise<ResolvedVisionImage> {
    const thread = await this.threadStore.getThread(threadId);
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
    if (!attachment) {
      throw new Error(`当前会话中没有可用的图片附件：${requestedId}`);
    }
    if (isRuntimeInlineMessageAttachment(attachment)) {
      const inline = decodeInlineImage(attachment);
      if (!inline) throw new Error('图片附件不是受支持的 PNG、JPEG、GIF 或 WebP 文件。');
      return {
        id: attachment.id,
        name: attachment.name,
        ...inline,
      };
    }

    const resolved = (await this.attachmentStore.resolveForThread(threadId, [attachment]))[0];
    if (!resolved) throw new Error(`图片附件不可用或不属于当前会话：${requestedId}`);
    const data = await readFile(resolved.absolutePath);
    if (!data.byteLength || data.byteLength !== resolved.attachment.size) {
      throw new Error('图片附件为空或读取不完整。');
    }
    const mimeType = detectSafeImageMimeType(data);
    if (!mimeType || mimeType !== attachment.type) {
      throw new Error('图片附件不是受支持的 PNG、JPEG、GIF 或 WebP 文件。');
    }
    return {
      id: attachment.assetId,
      name: attachment.name,
      mimeType,
      data,
    };
  }

  private async availableModel(): Promise<SelectedVisionModel | null> {
    const config = await this.configStore.getConfig();
    const reference = config.visionRecognition;
    if (!reference) return null;
    const provider = config.providers.find((item) => item.enabled && item.id === reference.providerId);
    const model = provider?.models.find((item) => item.id === reference.modelId);
    if (!provider || !model?.enabled || !model.supportsImages || !model.code.trim()) return null;
    return { reference, provider, model };
  }
}

function visionRequestMessage(prompt: string, image: ResolvedVisionImage): RuntimeMessage {
  return {
    id: 'vision_recognition_request',
    role: 'user',
    content: prompt,
    createdAt: new Date().toISOString(),
    status: 'complete',
    attachments: [{
      id: image.id,
      name: image.name,
      type: image.mimeType,
      size: image.data.byteLength,
      source: 'inline',
      modelVisible: true,
      url: `data:${image.mimeType};base64,${image.data.toString('base64')}`,
    }],
  };
}

function decodeInlineImage(
  attachment: RuntimeInlineMessageAttachment,
): Pick<ResolvedVisionImage, 'mimeType' | 'data'> | null {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z\d+/=\s]+)$/iu.exec(attachment.url);
  if (!match?.[1] || !match[2]) return null;
  const mimeType = match[1].toLowerCase() as SafeImageMimeType;
  const payload = match[2].replace(/\s/gu, '');
  if (mimeType !== attachment.type || !payload.length || payload.length % 4 !== 0) return null;
  const data = Buffer.from(payload, 'base64');
  if (!data.byteLength
    || data.byteLength !== attachment.size
    || data.toString('base64') !== payload) return null;
  return detectSafeImageMimeType(data) === mimeType ? { mimeType, data } : null;
}

function validatedPrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt) throw new Error('prompt must be a non-empty string.');
  if (prompt.length > RUNTIME_VISION_RECOGNITION_PROMPT_MAX_CHARS) {
    throw new Error(`prompt must not exceed ${RUNTIME_VISION_RECOGNITION_PROMPT_MAX_CHARS} characters.`);
  }
  return prompt;
}
