import {
  isRuntimeGeneratedMessageAttachment,
  OPENAI_IMAGE_GENERATION_PLUGIN_ID,
  OPENAI_IMAGE_GENERATION_TOOL_NAME,
  RUNTIME_IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS,
  type RuntimeImageGenerationTestInput,
  type RuntimeImageGenerationTestResult,
  type RuntimeMessageAttachment,
  type RuntimeThread,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { RuntimeImageGenerationProviderConfig } from '../../ports/config-store.js';
import type { GeneratedImageStore } from '../../ports/generated-image-store.js';
import type { PluginBundleStore } from '../../ports/plugin-bundle-store.js';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import type {
  ToolExecutionContext,
  ToolExecutionPreview,
  ToolExecutionResult,
  ToolHost,
  ToolTurnCleanupOutcome,
} from '../../ports/tool-host.js';
import { managedGeneratedImageAssetIdsFromStore } from '../../utils/generated-image-assets.js';
import { detectSafeImageMimeType, type SafeImageMimeType } from '../../utils/safe-image.js';
import { boundedIntegerArg, objectInput, optionalStringArg, requiredStringArg } from './tool-input.js';
import { workspaceProjectIdForToolContext } from './workspace-tool-context.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_ENCODED_IMAGE_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1_024;
const MAX_RESPONSE_BYTES = Math.ceil((MAX_TOTAL_IMAGE_BYTES * 4) / 3) + 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RETAINED_QUICK_TEST_ASSETS = 12;

type ImageGenerationConfigStore = {
  getImageGenerationConfig(): Promise<RuntimeImageGenerationProviderConfig>;
};

type ImageGenerationPluginStore = Pick<PluginBundleStore, 'listPlugins'>;

type GeneratedImageReferenceStore = {
  listThreads(query?: { includeArchived?: boolean }): Promise<Array<{ id: string }>>;
  getThread(threadId: string): Promise<Pick<RuntimeThread, 'messages'> | null>;
};

type OpenAiImageGenerationToolHostOptions = {
  fetchImpl?: typeof fetch;
  threadStore?: GeneratedImageReferenceStore;
  workspaceProjects?: Pick<WorkspaceProjectStore, 'deleteFile' | 'writeBinaryFile'>;
};

type GeneratedWorkspaceFile = {
  path: string;
  projectId: string;
};

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
      model: { type: 'string', description: 'Optional model override. Use only when the user explicitly requests a model.' },
      n: { type: 'integer', minimum: 1, maximum: 10, description: 'Number of variants for this same prompt. Omit for one image.' },
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
  private readonly pendingAssetIdsByTurn = new Map<string, Set<string>>();
  private readonly quickTestAssetIds: string[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly threadStore?: GeneratedImageReferenceStore;
  private readonly workspaceProjects?: Pick<WorkspaceProjectStore, 'deleteFile' | 'writeBinaryFile'>;
  private quickTestSequence = 0;

  constructor(
    private readonly configStore: ImageGenerationConfigStore,
    private readonly pluginStore: ImageGenerationPluginStore,
    private readonly generatedImageStore: GeneratedImageStore,
    options: OpenAiImageGenerationToolHostOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.threadStore = options.threadStore;
    this.workspaceProjects = options.workspaceProjects;
  }

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    if (context.features?.plugins === false) return [];
    return await this.isAvailable() ? [IMAGE_GENERATION_TOOL] : [];
  }

  async toolRuntimeProfile(name: string) {
    if (name !== OPENAI_IMAGE_GENERATION_TOOL_NAME) return null;
    const plugin = (await this.pluginStore.listPlugins()).plugins
      .find((item) => item.id === OPENAI_IMAGE_GENERATION_PLUGIN_ID);
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

  async systemPrompt(_context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<string | null> {
    if (request && !request.tools.some((tool) => tool.name === OPENAI_IMAGE_GENERATION_TOOL_NAME)) return null;
    return await this.isAvailable()
      ? [
          'Use generate_image only when the user explicitly asks to create a new image; it does not edit existing images.',
          'Put the intended use, subject, scene, style, composition, lighting, exact requested text, and constraints into one concise prompt.',
          'Use n only for variants of the same prompt. Generate distinct assets with separate calls.',
          'When the result lists workspace files, use those exact paths for publish_artifact; never guess a generated filename or search for it.',
          'Omit optional provider parameters unless the user requested them or support is known. Never ask for or reveal API keys.',
        ].join(' ')
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

  /**
   * 配置页快速测试复用正式工具链，但使用只读、无会话的执行上下文：图片可预览和导出，
   * 不会写入工作区或线程上下文，也不会把密钥返回给 renderer。
   */
  async testGeneration(
    input: RuntimeImageGenerationTestInput,
    signal?: AbortSignal,
  ): Promise<RuntimeImageGenerationTestResult> {
    const prompt = requiredStringArg(objectInput(input).prompt, 'prompt');
    if (prompt.length > RUNTIME_IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS) {
      throw new Error(`测试提示词不能超过 ${RUNTIME_IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS} 个字符。`);
    }
    const startedAt = Date.now();
    this.quickTestSequence += 1;
    const result = await this.runTool(
      OPENAI_IMAGE_GENERATION_TOOL_NAME,
      { prompt, n: 1 },
      {
        threadId: 'image_generation_quick_test',
        toolCallId: `quick_test_${Date.now()}_${this.quickTestSequence}`,
        permissionProfile: 'read-only',
        signal,
      },
    );
    const images = (result.attachments ?? []).filter(isRuntimeGeneratedMessageAttachment);
    if (!images.length) throw new Error('图片生成服务未返回可预览的图片。');
    await this.retainQuickTestAssets(images.map((image) => image.assetId));
    const model = imageGenerationResultModel(result.data);
    return {
      images,
      durationMs: Math.max(0, Date.now() - startedAt),
      ...(model ? { model } : {}),
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
    const n = optionalBoundedIntegerArg(args.n, 1, 10);
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
    const storedAssetIds: string[] = [];
    const workspaceFiles: GeneratedWorkspaceFile[] = [];
    let totalBytes = 0;
    try {
      for (const [index, item] of items.entries()) {
        const converted = await this.toAttachment(item, index, endpoint, context, signal, totalBytes);
        totalBytes += converted.attachment.size;
        storedAssetIds.push(converted.assetId);
        attachments.push(converted.attachment);
        if (converted.workspaceFile) workspaceFiles.push(converted.workspaceFile);
      }
    } catch (error) {
      await Promise.allSettled([
        ...storedAssetIds.map((assetId) => this.generatedImageStore.delete(assetId)),
        ...workspaceFiles.map((file) => this.workspaceProjects?.deleteFile(file.projectId, file.path)),
      ]);
      throw error;
    }
    const revisedPrompts = items
      .map((item) => typeof item.revised_prompt === 'string' ? item.revised_prompt.trim() : '')
      .filter(Boolean);

    const result: ToolExecutionResult = {
      content: [
        `Generated ${attachments.length} image${attachments.length === 1 ? '' : 's'} successfully.`,
        ...(workspaceFiles.length
          ? [
              'Workspace files ready for publish_artifact (use these exact paths):',
              ...workspaceFiles.map((file) => `- ${file.path}`),
            ]
          : []),
        ...(revisedPrompts.length ? [`Revised prompt: ${revisedPrompts.join('\n')}`] : []),
      ].join('\n'),
      attachments,
      preview: `已生成 ${attachments.length} 张图片`,
      data: {
        pluginId: OPENAI_IMAGE_GENERATION_PLUGIN_ID,
        imageCount: attachments.length,
        ...(workspaceFiles.length ? { workspaceFiles } : {}),
        ...(model ? { model } : {}),
        ...(typeof body.size === 'string' ? { size: body.size } : {}),
      },
      containsExternalContext: true,
    };
    this.trackPendingAssets(context, storedAssetIds);
    return result;
  }

  async cleanupTurn(context: ToolExecutionContext, _outcome: ToolTurnCleanupOutcome): Promise<void> {
    const turnKey = generatedImageTurnKey(context);
    if (!turnKey) return;
    const pendingAssetIds = this.pendingAssetIdsByTurn.get(turnKey);
    this.pendingAssetIdsByTurn.delete(turnKey);
    const threadStore = this.threadStore;
    if (!pendingAssetIds?.size || !threadStore) return;

    const referencedAssetIds = await managedGeneratedImageAssetIdsFromStore(threadStore, pendingAssetIds);
    const orphanedAssetIds = [...pendingAssetIds].filter((assetId) => !referencedAssetIds.has(assetId));
    await Promise.allSettled(orphanedAssetIds.map((assetId) => this.generatedImageStore.delete(assetId)));
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

  private trackPendingAssets(context: ToolExecutionContext, assetIds: string[]): void {
    const turnKey = generatedImageTurnKey(context);
    if (!turnKey) return;
    const pending = this.pendingAssetIdsByTurn.get(turnKey) ?? new Set<string>();
    for (const assetId of assetIds) pending.add(assetId);
    this.pendingAssetIdsByTurn.set(turnKey, pending);
  }

  private async retainQuickTestAssets(assetIds: string[]): Promise<void> {
    this.quickTestAssetIds.push(...assetIds);
    const overflow = this.quickTestAssetIds.length - MAX_RETAINED_QUICK_TEST_ASSETS;
    if (overflow <= 0) return;
    const expiredAssetIds = this.quickTestAssetIds.splice(0, overflow);
    await Promise.allSettled(expiredAssetIds.map((assetId) => this.generatedImageStore.delete(assetId)));
  }

  private async toAttachment(
    item: OpenAiImageResponseItem,
    index: number,
    endpoint: string,
    context: ToolExecutionContext,
    signal: AbortSignal,
    currentTotalBytes: number,
  ): Promise<{ assetId: string; attachment: RuntimeMessageAttachment; workspaceFile?: GeneratedWorkspaceFile }> {
    const buffer = typeof item.b64_json === 'string' && item.b64_json.trim()
      ? decodeBase64Image(item.b64_json)
      : typeof item.url === 'string' && item.url.trim()
        ? await downloadImage(this.fetchImpl, new URL(item.url, endpoint).toString(), signal)
        : null;
    if (!buffer) throw new Error(`图片生成响应中的第 ${index + 1} 项缺少 b64_json 或 url。`);
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error(`第 ${index + 1} 张图片超过 20 MB 限制。`);
    if (currentTotalBytes + buffer.byteLength > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('本次生成图片总大小超过 50 MB 限制。');
    }
    const mimeType = detectSafeImageMimeType(buffer);
    if (!mimeType) throw new Error(`第 ${index + 1} 张图片不是受支持的 PNG、JPEG、GIF 或 WebP。`);
    const suffix = imageExtension(mimeType);
    const name = `generated-${index + 1}.${suffix}`;
    const storedImage = await this.generatedImageStore.create({
      name,
      type: mimeType,
      data: buffer,
    });
    let workspaceFile: GeneratedWorkspaceFile | undefined;
    try {
      workspaceFile = await this.writeWorkspaceImage(context, index, suffix, buffer);
    } catch (error) {
      await this.generatedImageStore.delete(storedImage.assetId).catch(() => undefined);
      throw error;
    }
    const baseAttachment = {
      id: `generated_image_${safeIdPart(context.toolCallId ?? String(Date.now()))}_${index + 1}`,
      name,
      type: mimeType,
      size: buffer.byteLength,
      modelVisible: false as const,
    };
    return {
      assetId: storedImage.assetId,
      attachment: { ...baseAttachment, source: 'generated', assetId: storedImage.assetId },
      ...(workspaceFile ? { workspaceFile } : {}),
    };
  }

  private async writeWorkspaceImage(
    context: ToolExecutionContext,
    index: number,
    suffix: string,
    buffer: Uint8Array,
  ): Promise<GeneratedWorkspaceFile | undefined> {
    const projects = this.workspaceProjects;
    const projectId = workspaceProjectIdForToolContext(undefined, context);
    // The managed image asset remains available for chat preview, but read-only turns
    // must not gain an implicit workspace write through image generation.
    if (!projects || !projectId || context.permissionProfile === 'read-only') return undefined;
    const callId = safeIdPart(context.toolCallId ?? `image_${Date.now()}`);
    const file = await projects.writeBinaryFile(
      projectId,
      `generated-images/${callId}-${index + 1}.${suffix}`,
      buffer,
    );
    return { projectId, path: file.path.replace(/\\/gu, '/') };
  }
}

function generatedImageTurnKey(context: ToolExecutionContext): string | null {
  return context.turnId ? `${context.threadId}\u0000${context.turnId}` : null;
}

function imageGenerationResultModel(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const model = (data as { model?: unknown }).model;
  return typeof model === 'string' && model.trim() ? model.trim() : undefined;
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
  const text = (await readBoundedResponse(response, MAX_RESPONSE_BYTES, '图片生成服务响应超过大小限制。')).toString('utf8');
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
  if (encoded.length > MAX_ENCODED_IMAGE_CHARS) throw new Error('生成图片超过 20 MB 限制。');
  return Buffer.from(encoded, 'base64');
}

async function downloadImage(fetchImpl: typeof fetch, url: string, signal: AbortSignal): Promise<Buffer> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`下载生成图片失败（HTTP ${response.status}）。`);
  return readBoundedResponse(response, MAX_IMAGE_BYTES, '生成图片超过 20 MB 限制。');
}

async function readBoundedResponse(response: Response, maxBytes: number, tooLargeMessage: string): Promise<Buffer> {
  const announcedSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(announcedSize) && announcedSize > maxBytes) throw new Error(tooLargeMessage);
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(tooLargeMessage);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

function imageExtension(mimeType: SafeImageMimeType): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  return mimeType.slice('image/'.length);
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, '_').slice(0, 120) || 'image';
}
