import {
  isRuntimeStoredMessageAttachment,
  OPENAI_VISION_RECOGNITION_PLUGIN_ID,
  OPENAI_VISION_RECOGNITION_TOOL_NAME,
  RUNTIME_VISION_RECOGNITION_PROMPT_MAX_CHARS,
  type ProviderModelConfig,
  type RuntimeConfiguredModelReference,
  type RuntimeMessage,
  type RuntimeStoredMessageAttachment,
  type RuntimeToolDefinition,
  type RuntimeVisionRecognitionTestInput,
  type RuntimeVisionRecognitionTestResult,
} from '@setsuna-desktop/contracts';
import { readFile } from 'node:fs/promises';
import type { AttachmentStore } from '../../ports/attachment-store.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type {
  ToolExecutionContext,
  ToolExecutionPreview,
  ToolExecutionResult,
  ToolHost,
} from '../../ports/tool-host.js';
import { detectSafeImageMimeType, type SafeImageMimeType } from '../../utils/safe-image.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';
import { objectInput, requiredStringArg } from './tool-input.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_RESULT_CHARS = 64_000;
const MAX_OUTPUT_TOKENS = 4_096;
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

type VisionRecognitionConfigStore = Pick<ConfigStore, 'getConfig'>;
type VisionRecognitionPluginStore = Pick<PluginBundleStore, 'listPlugins'>;
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
  model: ProviderModelConfig;
};

const VISION_RECOGNITION_TOOL: RuntimeToolDefinition = {
  name: OPENAI_VISION_RECOGNITION_TOOL_NAME,
  description: 'Analyze a runtime-managed image attachment with the configured vision model.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      attachment_id: {
        type: 'string',
        description: 'The attachment id from the runtime-managed attachment list for this thread.',
      },
      prompt: {
        type: 'string',
        description: 'The question or visual analysis task to send with the image.',
      },
    },
    required: ['attachment_id', 'prompt'],
  },
};

/**
 * 将当前线程拥有的图片交给用户已配置的视觉模型。工具只保存模型引用并复用
 * 现有 provider 凭据、协议和代理；路径解析仍留在 runtime，避免读取任意文件。
 */
export class OpenAiVisionRecognitionToolHost implements ToolHost {
  constructor(
    private readonly configStore: VisionRecognitionConfigStore,
    private readonly pluginStore: VisionRecognitionPluginStore,
    private readonly attachmentStore: VisionRecognitionAttachmentStore,
    private readonly threadStore: VisionRecognitionThreadStore,
    private readonly modelClient: VisionRecognitionModelClient,
  ) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    if (context.features?.plugins === false) return [];
    return await this.availableModel() ? [VISION_RECOGNITION_TOOL] : [];
  }

  async toolRuntimeProfile(name: string) {
    if (name !== OPENAI_VISION_RECOGNITION_TOOL_NAME) return null;
    const plugin = (await this.pluginStore.listPlugins()).plugins
      .find((item) => item.id === OPENAI_VISION_RECOGNITION_PLUGIN_ID);
    return {
      exposure: 'direct' as const,
      supportsParallel: false,
      ...(plugin ? {
        plugin: {
          id: plugin.id,
          name: plugin.name,
          ...(plugin.icon ? { icon: plugin.icon } : {}),
        },
      } : {}),
    };
  }

  async systemPrompt(context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<string | null> {
    if (request && !request.tools.some((tool) => tool.name === OPENAI_VISION_RECOGNITION_TOOL_NAME)) return null;
    if (!await this.availableModel()) return null;
    return context.modelCapabilities?.supportsImages === true
      ? 'The current model can inspect inline images directly. Use analyze_image only when the user explicitly asks to use the configured vision model or provides a runtime-managed image attachment.'
      : 'When the user asks about a runtime-managed image attachment, call analyze_image with its attachment id and the concrete visual question. Do not claim to have inspected an image before the tool returns.';
  }

  async previewToolCall(name: string, input: unknown): Promise<ToolExecutionPreview | null> {
    if (name !== OPENAI_VISION_RECOGNITION_TOOL_NAME) return null;
    const args = objectInput(input);
    const attachmentId = requiredStringArg(args.attachment_id, 'attachment_id');
    const prompt = requiredStringArg(args.prompt, 'prompt');
    return {
      argumentsPreview: `${attachmentId}: ${prompt}`,
      resultPreview: `使用已配置的视觉模型分析附件 ${attachmentId}`,
    };
  }

  async testRecognition(
    input: RuntimeVisionRecognitionTestInput,
    signal?: AbortSignal,
  ): Promise<RuntimeVisionRecognitionTestResult> {
    const prompt = validatedPrompt(input.prompt);
    const selection = await this.availableModel();
    if (!selection) throw new Error('视觉识别插件未安装，或尚未选择可用的视觉模型。');
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

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (name !== OPENAI_VISION_RECOGNITION_TOOL_NAME) throw new Error(`Unknown tool: ${name}`);
    const selection = await this.availableModel();
    if (!selection) throw new Error('视觉识别插件未安装，或尚未选择可用的视觉模型。');
    const args = objectInput(input);
    const attachmentId = requiredStringArg(args.attachment_id, 'attachment_id');
    const prompt = validatedPrompt(requiredStringArg(args.prompt, 'prompt'));
    const image = await this.resolveImage(context.threadId, attachmentId);
    const content = await this.analyzeImage(selection, prompt, image, context.signal);
    return {
      content: `Vision model analysis for ${image.name}:\n${content}`,
      preview: content.slice(0, 240),
      data: {
        pluginId: OPENAI_VISION_RECOGNITION_PLUGIN_ID,
        attachmentId: image.id,
        providerId: selection.reference.providerId,
        modelId: selection.reference.modelId,
        model: selection.model.code,
      },
      containsExternalContext: true,
    };
  }

  private async analyzeImage(
    selection: SelectedVisionModel,
    prompt: string,
    image: ResolvedVisionImage,
    signal?: AbortSignal,
  ): Promise<string> {
    const collector = createModelStreamTextCollector();
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
      if (collector.text().length > MAX_RESULT_CHARS) {
        throw new Error(`视觉识别结果超过 ${MAX_RESULT_CHARS.toLocaleString('en-US')} 字符限制。`);
      }
    }
    const content = collector.text().trim();
    if (!content) throw new Error('视觉模型没有返回可用文本。');
    return content;
  }

  private async resolveImage(threadId: string, requestedId: string): Promise<ResolvedVisionImage> {
    const thread = await this.threadStore.getThread(threadId);
    if (!thread) throw new Error('当前会话不存在，无法读取图片附件。');
    const attachment = thread.messages
      .flatMap((message) => message.attachments ?? [])
      .find((item): item is RuntimeStoredMessageAttachment => (
        isRuntimeStoredMessageAttachment(item)
        && (item.assetId === requestedId || item.id === requestedId)
      ));
    if (!attachment || !attachment.type.startsWith('image/')) {
      throw new Error(`当前会话中没有可用的图片附件：${requestedId}`);
    }
    const resolved = (await this.attachmentStore.resolveForThread(threadId, [attachment]))[0];
    if (!resolved) throw new Error(`图片附件不可用或不属于当前会话：${requestedId}`);
    const data = await readFile(resolved.absolutePath);
    if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('图片附件为空或超过 20 MB 限制。');
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
    const [{ plugins }, config] = await Promise.all([
      this.pluginStore.listPlugins(),
      this.configStore.getConfig(),
    ]);
    if (!plugins.some((plugin) => plugin.id === OPENAI_VISION_RECOGNITION_PLUGIN_ID)) return null;
    const reference = config.visionRecognition;
    if (!reference) return null;
    const provider = config.providers.find((item) => item.enabled && item.id === reference.providerId);
    const model = provider?.models.find((item) => item.id === reference.modelId);
    if (!provider || !model?.enabled || !model.supportsImages || !model.code.trim()) return null;
    return { reference, model };
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

function validatedPrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt) throw new Error('prompt must be a non-empty string.');
  if (prompt.length > RUNTIME_VISION_RECOGNITION_PROMPT_MAX_CHARS) {
    throw new Error(`prompt must not exceed ${RUNTIME_VISION_RECOGNITION_PROMPT_MAX_CHARS} characters.`);
  }
  return prompt;
}
