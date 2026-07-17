import {
  OPENAI_IMAGE_GENERATION_PLUGIN_ID,
  OPENAI_IMAGE_GENERATION_TOOL_NAME,
  type RuntimeMessageAttachment,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { RuntimeImageGenerationProviderConfig } from '../../ports/config-store.js';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { ToolExecutionContext, ToolExecutionPreview, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import { detectSafeImageMimeType, type SafeImageMimeType } from '../../utils/safe-image.js';
import { boundedIntegerArg, objectInput, optionalStringArg, requiredStringArg } from './tool-input.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

type ImageGenerationConfigStore = {
  getImageGenerationConfig(): Promise<RuntimeImageGenerationProviderConfig>;
};

type ImageGenerationPluginStore = Pick<PluginBundleStore, 'listPlugins'>;

type OpenAiImageResponseItem = {
  b64_json?: unknown;
  url?: unknown;
  revised_prompt?: unknown;
};

const IMAGE_GENERATION_TOOL: RuntimeToolDefinition = {
  name: OPENAI_IMAGE_GENERATION_TOOL_NAME,
  description: 'Generate one or more new images with the configured OpenAI-compatible Images API.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'A detailed description of the image to generate.' },
      model: { type: 'string', description: 'Optional model override. Uses the configured model when omitted.' },
      n: { type: 'integer', minimum: 1, maximum: 10, description: 'Number of images to generate. Defaults to 1.' },
      size: { type: 'string', description: 'Provider-supported image size, for example 1024x1024.' },
      quality: { type: 'string', description: 'Provider-supported quality, for example auto, standard, hd, low, medium, or high.' },
      background: { type: 'string', description: 'Provider-supported background mode, for example auto, transparent, or opaque.' },
      output_format: { type: 'string', description: 'Provider-supported output format, for example png, jpeg, or webp.' },
      output_compression: { type: 'integer', minimum: 0, maximum: 100, description: 'Compression level for supported output formats.' },
      response_format: { type: 'string', description: 'Legacy response format, usually b64_json or url.' },
      style: { type: 'string', description: 'Provider-supported style, for example vivid or natural.' },
      moderation: { type: 'string', description: 'Provider-supported moderation level, for example auto or low.' },
    },
    required: ['prompt'],
  },
};

/**
 * 图片生成由 runtime 直接调用服务，避免把 API key 或 HTTP 服务地址暴露给 renderer。
 * 插件本身只负责分发生图意图；卸载插件后本工具会立即从模型能力中消失。
 */
export class OpenAiImageGenerationToolHost implements ToolHost {
  constructor(
    private readonly configStore: ImageGenerationConfigStore,
    private readonly pluginStore: ImageGenerationPluginStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    if (context.features?.plugins === false) return [];
    return await this.isAvailable() ? [IMAGE_GENERATION_TOOL] : [];
  }

  toolRuntimeProfile(name: string) {
    return name === OPENAI_IMAGE_GENERATION_TOOL_NAME
      ? { exposure: 'direct' as const, supportsParallel: false }
      : null;
  }

  async systemPrompt(_context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<string | null> {
    if (request && !request.tools.some((tool) => tool.name === OPENAI_IMAGE_GENERATION_TOOL_NAME)) return null;
    return await this.isAvailable()
      ? 'Use generate_image when the user explicitly asks to create a new image. Put all visual requirements into prompt. Do not ask for or reveal API keys in chat.'
      : null;
  }

  async previewToolCall(name: string, input: unknown): Promise<ToolExecutionPreview | null> {
    if (name !== OPENAI_IMAGE_GENERATION_TOOL_NAME) return null;
    const args = objectInput(input);
    const prompt = requiredStringArg(args.prompt, 'prompt');
    return {
      argumentsPreview: prompt,
      resultPreview: `生成 ${boundedIntegerArg(args.n, 1, 1, 10)} 张图片`,
    };
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (name !== OPENAI_IMAGE_GENERATION_TOOL_NAME) throw new Error(`Unknown tool: ${name}`);
    const config = await this.availableConfig();
    if (!config) {
      throw new Error('图片生成插件未安装、未启用，或尚未配置服务地址与 API key。');
    }

    const args = objectInput(input);
    const prompt = requiredStringArg(args.prompt, 'prompt');
    const n = boundedIntegerArg(args.n, 1, 1, 10);
    const model = optionalStringArg(args.model) ?? (config.model || undefined);
    const endpoint = imageGenerationEndpoint(config.baseUrl);
    const body = compactObject({
      prompt,
      model,
      n,
      size: optionalStringArg(args.size),
      quality: optionalStringArg(args.quality),
      background: optionalStringArg(args.background),
      output_format: optionalStringArg(args.output_format),
      output_compression: optionalBoundedIntegerArg(args.output_compression, 0, 100),
      response_format: optionalStringArg(args.response_format),
      style: optionalStringArg(args.style),
      moderation: optionalStringArg(args.moderation),
    });
    const signal = combinedSignal(context.signal);
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(redactSecret(openAiErrorMessage(payload, response.status), config.apiKey));

    const items = imageResponseItems(payload).slice(0, 10);
    if (!items.length) throw new Error('图片生成服务返回成功，但响应中没有 data 图片。');
    const attachments: RuntimeMessageAttachment[] = [];
    let totalBytes = 0;
    for (const [index, item] of items.entries()) {
      const attachment = await this.toAttachment(item, index, endpoint, context.toolCallId, signal);
      totalBytes += attachment.size;
      if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('本次生成图片总大小超过 50 MB 限制。');
      attachments.push(attachment);
    }
    const revisedPrompts = items
      .map((item) => typeof item.revised_prompt === 'string' ? item.revised_prompt.trim() : '')
      .filter(Boolean);

    return {
      content: [
        `Generated ${attachments.length} image${attachments.length === 1 ? '' : 's'} successfully.`,
        ...(revisedPrompts.length ? [`Revised prompt: ${revisedPrompts.join('\n')}`] : []),
      ].join('\n'),
      attachments,
      preview: `已生成 ${attachments.length} 张图片`,
      data: {
        pluginId: OPENAI_IMAGE_GENERATION_PLUGIN_ID,
        imageCount: attachments.length,
        ...(model ? { model } : {}),
        ...(typeof body.size === 'string' ? { size: body.size } : {}),
      },
      containsExternalContext: true,
    };
  }

  private async isAvailable(): Promise<boolean> {
    return Boolean(await this.availableConfig());
  }

  private async availableConfig(): Promise<RuntimeImageGenerationProviderConfig | null> {
    const [{ plugins }, config] = await Promise.all([
      this.pluginStore.listPlugins(),
      this.configStore.getImageGenerationConfig(),
    ]);
    const installed = plugins.some((plugin) => plugin.id === OPENAI_IMAGE_GENERATION_PLUGIN_ID);
    return installed && Boolean(config.baseUrl.trim()) && Boolean(config.apiKey.trim())
      ? config
      : null;
  }

  private async toAttachment(
    item: OpenAiImageResponseItem,
    index: number,
    endpoint: string,
    toolCallId: string | undefined,
    signal: AbortSignal,
  ): Promise<RuntimeMessageAttachment> {
    const buffer = typeof item.b64_json === 'string' && item.b64_json.trim()
      ? decodeBase64Image(item.b64_json)
      : typeof item.url === 'string' && item.url.trim()
        ? await downloadImage(this.fetchImpl, new URL(item.url, endpoint).toString(), signal)
        : null;
    if (!buffer) throw new Error(`图片生成响应中的第 ${index + 1} 项缺少 b64_json 或 url。`);
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error(`第 ${index + 1} 张图片超过 20 MB 限制。`);
    const mimeType = detectSafeImageMimeType(buffer);
    if (!mimeType) throw new Error(`第 ${index + 1} 张图片不是受支持的 PNG、JPEG、GIF 或 WebP。`);
    const suffix = imageExtension(mimeType);
    return {
      id: `generated_image_${safeIdPart(toolCallId ?? String(Date.now()))}_${index + 1}`,
      name: `generated-${index + 1}.${suffix}`,
      type: mimeType,
      size: buffer.byteLength,
      url: `data:${mimeType};base64,${buffer.toString('base64')}`,
      modelVisible: false,
    };
  }
}

export function imageGenerationEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  url.search = '';
  url.hash = '';
  const path = url.pathname.replace(/\/+$/u, '');
  if (/\/images\/generations$/u.test(path)) {
    url.pathname = path;
  } else if (/\/v1$/u.test(path)) {
    url.pathname = `${path}/images/generations`;
  } else {
    url.pathname = `${path}/v1/images/generations`.replace(/\/{2,}/gu, '/');
  }
  return url.toString();
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function optionalBoundedIntegerArg(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return boundedIntegerArg(value, min, min, max);
}

function combinedSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`图片生成服务返回了非 JSON 响应（HTTP ${response.status}）。`);
  }
}

function openAiErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return `图片生成失败（HTTP ${status}）：${error.trim()}`;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return `图片生成失败（HTTP ${status}）：${message.trim()}`;
    }
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) return `图片生成失败（HTTP ${status}）：${detail.trim()}`;
  }
  return `图片生成失败（HTTP ${status}）。`;
}

function redactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join('[REDACTED]') : value;
}

function imageResponseItems(payload: unknown): OpenAiImageResponseItem[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is OpenAiImageResponseItem => Boolean(item && typeof item === 'object'));
}

function decodeBase64Image(value: string): Buffer {
  const encoded = value.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/iu, '');
  return Buffer.from(encoded, 'base64');
}

async function downloadImage(fetchImpl: typeof fetch, url: string, signal: AbortSignal): Promise<Buffer> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`下载生成图片失败（HTTP ${response.status}）。`);
  const announcedSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(announcedSize) && announcedSize > MAX_IMAGE_BYTES) throw new Error('生成图片超过 20 MB 限制。');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('生成图片超过 20 MB 限制。');
  return buffer;
}

function imageExtension(mimeType: SafeImageMimeType): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  return mimeType.slice('image/'.length);
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, '_').slice(0, 120) || 'image';
}
