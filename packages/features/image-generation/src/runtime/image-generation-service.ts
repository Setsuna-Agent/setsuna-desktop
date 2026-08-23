import {
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  type RuntimeMessageAttachment,
  type RuntimeRasterImageMimeType,
} from '@setsuna-desktop/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { RuntimeFeatureSettingsDocumentHandle } from '@setsuna-desktop/feature-core/settings';
import type { FeatureSettingsDiagnosis } from '@setsuna-desktop/feature-core/settings';
import type { FeatureHealthReporter } from '@setsuna-desktop/feature-core/status';
import {
  IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS,
  type ImageGenerationConnection,
  type ImageGenerationConnectionPatch,
  type ImageGenerationExecutionContext,
  type ImageGenerationGeneratedImageStore,
  type ImageGenerationHealth,
  type ImageGenerationNetwork,
  type ImageGenerationPublicConnection,
  type ImageGenerationReferenceReader,
  type ImageGenerationResult,
  type ImageGenerationSecretPatch,
  type ImageGenerationService,
  type ImageGenerationSettingsState,
  type ImageGenerationSettingsUpdate,
  type ImageGenerationTestInput,
  type ImageGenerationTestResult,
  type ImageGenerationTurnCleanupOutcome,
  type ImageGenerationWorkspaceFile,
  type ImageGenerationWorkspaceFiles,
} from '../contracts/index.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_ENCODED_IMAGE_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1_024;
const MAX_RESPONSE_BYTES = Math.ceil((MAX_TOTAL_IMAGE_BYTES * 4) / 3) + 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RETAINED_QUICK_TEST_ASSETS = 12;

type ConnectionHandle = RuntimeFeatureSettingsDocumentHandle<
  ImageGenerationConnection,
  ImageGenerationPublicConnection,
  ImageGenerationConnectionPatch,
  ImageGenerationSecretPatch
>;

type AppliedConnection = Readonly<{
  revision: number;
  baseUrl: string;
  model: string;
  apiKey: string;
}>;

type OpenAiImageResponseItem = Readonly<{
  b64_json?: unknown;
  url?: unknown;
  revised_prompt?: unknown;
}>;

export class RuntimeImageGenerationService implements ImageGenerationService {
  private readonly pendingAssetIdsByTurn = new Map<string, Set<string>>();
  private readonly quickTestAssetIds: string[] = [];
  private applied: AppliedConnection | null = null;
  private health: ImageGenerationHealth = 'not-configured';
  private quickTestSequence = 0;
  private refreshTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly scope: FeatureScope,
    private readonly settings: ConnectionHandle,
    private readonly generatedImages: ImageGenerationGeneratedImageStore,
    private readonly references: ImageGenerationReferenceReader,
    private readonly network: ImageGenerationNetwork,
    private readonly workspaceFiles: ImageGenerationWorkspaceFiles | null,
    private readonly healthReporter: FeatureHealthReporter,
    private readonly diagnose: () => Promise<FeatureSettingsDiagnosis>,
  ) {}

  async initialize(): Promise<void> {
    await this.refreshAppliedConnection();
    const unsubscribe = this.settings.subscribeRuntime(() => {
      void this.queueRefresh();
    });
    this.scope.add(unsubscribe);
  }

  async isAvailable(): Promise<boolean> {
    return this.scope.runOperation(async () => {
      await this.queueRefresh();
      return this.applied !== null;
    });
  }

  readSettings(): Promise<ImageGenerationSettingsState> {
    return this.scope.runOperation(() => this.readSettingsInternal());
  }

  updateSettings(input: ImageGenerationSettingsUpdate): Promise<ImageGenerationSettingsState> {
    return this.scope.runOperation(async () => {
      try {
        await this.settings.update(input);
        await this.queueRefresh();
        return this.readSettingsInternal();
      } catch (error) {
        throw settingsFailure(error);
      }
    });
  }

  diagnoseSettings(): Promise<FeatureSettingsDiagnosis> {
    // Diagnosis itself is host-owned and deliberately remains reachable even if
    // execution is degraded; the facade only narrows it to this Feature document.
    return this.diagnose();
  }

  testGeneration(input: ImageGenerationTestInput, signal?: AbortSignal): Promise<ImageGenerationTestResult> {
    return this.scope.runOperation(async (operationSignal) => {
      const prompt = requiredString(input.prompt, 'prompt');
      if (prompt.length > IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS) {
        throw invalidInput(`Prompt must not exceed ${IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS} characters.`);
      }
      const startedAt = Date.now();
      this.quickTestSequence += 1;
      const result = await this.generateInternal(
        { prompt, n: 1 },
        {
          threadId: 'image_generation_quick_test',
          toolCallId: `quick_test_${Date.now()}_${this.quickTestSequence}`,
          permissionProfile: 'read-only',
          signal: operationSignal,
        },
      );
      const images = result.attachments.filter(isRuntimeGeneratedMessageAttachment);
      if (!images.length) throw providerUnavailable('Image provider returned no previewable images.');
      await this.retainQuickTestAssets(images.map((image) => image.assetId));
      return Object.freeze({
        images,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(result.model ? { model: result.model } : {}),
      });
    }, { signal });
  }

  generate(input: unknown, context: ImageGenerationExecutionContext): Promise<ImageGenerationResult> {
    return this.scope.runOperation(
      (signal) => this.generateInternal(input, { ...context, signal }),
      { signal: context.signal },
    );
  }

  cleanupTurn(
    context: ImageGenerationExecutionContext,
    _outcome: ImageGenerationTurnCleanupOutcome,
  ): Promise<void> {
    return this.scope.runOperation(async () => {
      const turnKey = generatedImageTurnKey(context);
      if (!turnKey) return;
      const pendingAssetIds = this.pendingAssetIdsByTurn.get(turnKey);
      this.pendingAssetIdsByTurn.delete(turnKey);
      if (!pendingAssetIds?.size) return;

      const referenced = await managedGeneratedImageAssetIdsFromStore(this.references, pendingAssetIds);
      const orphaned = [...pendingAssetIds].filter((assetId) => !referenced.has(assetId));
      await Promise.allSettled(orphaned.map((assetId) => this.generatedImages.delete(assetId)));
    }, { signal: context.signal });
  }

  private async readSettingsInternal(): Promise<ImageGenerationSettingsState> {
    try {
      const current = await this.settings.readPublic();
      return Object.freeze({
        value: current.value,
        revision: current.revision,
        appliedRevision: this.applied?.revision ?? null,
        health: this.health,
      });
    } catch (error) {
      throw settingsFailure(error);
    }
  }

  private queueRefresh(): Promise<void> {
    const refresh = this.refreshTail.then(() => this.refreshAppliedConnection());
    this.refreshTail = refresh.catch(() => undefined);
    return refresh;
  }

  private async refreshAppliedConnection(): Promise<void> {
    try {
      const current = await this.settings.read();
      const apiKey = await this.settings.readSecret('api-key') ?? '';
      if (!current.value.baseUrl.trim()) {
        this.setUnavailable('not-configured', 'IMAGE_GENERATION_NOT_CONFIGURED', 'Image generation service URL is not configured.');
        return;
      }
      if (!apiKey.trim()) {
        this.setUnavailable('credentials-missing', 'IMAGE_GENERATION_CREDENTIALS_MISSING', 'Image generation credentials are missing.');
        return;
      }
      const previousRevision = this.applied?.revision;
      this.applied = Object.freeze({
        revision: current.revision,
        baseUrl: current.value.baseUrl,
        model: current.value.model,
        apiKey,
      });
      // A tool-list refresh proves only that local settings are readable. Keep
      // the provider fault until a request succeeds or a new config revision is applied.
      if (this.health !== 'provider-unavailable' || previousRevision !== current.revision) {
        this.markReady();
      }
    } catch {
      this.setUnavailable(
        'settings-invalid',
        'IMAGE_GENERATION_SETTINGS_INVALID',
        'Image generation settings could not be applied.',
      );
    }
  }

  private setUnavailable(health: ImageGenerationHealth, code: string, message: string): void {
    this.applied = null;
    this.health = health;
    this.healthReporter.markDegraded({ code, message });
  }

  private markProviderUnavailable(revision: number, message: string): void {
    if (this.applied?.revision !== revision) return;
    this.health = 'provider-unavailable';
    this.healthReporter.markDegraded({
      code: 'IMAGE_GENERATION_PROVIDER_UNAVAILABLE',
      message,
    });
  }

  private markReady(): void {
    this.health = 'ready';
    this.healthReporter.markActive();
  }

  private markReadyForRevision(revision: number): void {
    if (this.applied?.revision === revision) this.markReady();
  }

  private async generateInternal(
    input: unknown,
    context: ImageGenerationExecutionContext,
  ): Promise<ImageGenerationResult> {
    await this.queueRefresh();
    const config = this.applied;
    if (!config) throw unavailableForHealth(this.health);

    const args = objectInput(input);
    const prompt = requiredString(args.prompt, 'prompt');
    const n = optionalBoundedInteger(args.n, 1, 10);
    const model = optionalString(args.model) ?? (config.model || undefined);
    const endpoint = imageGenerationEndpoint(config.baseUrl);
    const body = compactObject({
      prompt,
      model,
      n,
      size: optionalString(args.size),
      quality: optionalString(args.quality),
      background: optionalString(args.background),
      output_format: optionalString(args.output_format),
      output_compression: optionalBoundedInteger(args.output_compression, 0, 100),
      response_format: optionalString(args.response_format),
      style: optionalString(args.style),
      moderation: optionalString(args.moderation),
    });
    const signal = combinedSignal(context.signal);

    let response: Response;
    let payload: unknown;
    try {
      response = await this.network.fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
      payload = await readJsonResponse(response);
    } catch (error) {
      if (signal.aborted) throw error;
      this.markProviderUnavailable(config.revision, 'Image generation provider is unavailable.');
      throw providerUnavailable(redactSecret(errorMessage(error), config.apiKey));
    }
    if (!response.ok) {
      this.markProviderUnavailable(config.revision, 'Image generation provider rejected the request.');
      throw providerUnavailable(redactSecret(openAiErrorMessage(payload, response.status), config.apiKey));
    }

    const items = imageResponseItems(payload).slice(0, 10);
    if (!items.length) throw providerUnavailable('Image provider response did not contain images.');
    const attachments: RuntimeMessageAttachment[] = [];
    const storedAssetIds: string[] = [];
    const workspaceFiles: ImageGenerationWorkspaceFile[] = [];
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
        ...storedAssetIds.map((assetId) => this.generatedImages.delete(assetId)),
        ...workspaceFiles.map((file) => this.workspaceFiles?.deleteFile(file.projectId, file.path)),
      ]);
      throw error;
    }

    this.markReadyForRevision(config.revision);
    const revisedPrompts = items
      .map((item) => typeof item.revised_prompt === 'string' ? item.revised_prompt.trim() : '')
      .filter(Boolean);
    this.trackPendingAssets(context, storedAssetIds);
    return Object.freeze({
      attachments,
      workspaceFiles,
      revisedPrompts,
      ...(model ? { model } : {}),
      ...(typeof body.size === 'string' ? { size: body.size } : {}),
    });
  }

  private async toAttachment(
    item: OpenAiImageResponseItem,
    index: number,
    endpoint: string,
    context: ImageGenerationExecutionContext,
    signal: AbortSignal,
    currentTotalBytes: number,
  ): Promise<{
    assetId: string;
    attachment: RuntimeMessageAttachment;
    workspaceFile?: ImageGenerationWorkspaceFile;
  }> {
    const buffer = typeof item.b64_json === 'string' && item.b64_json.trim()
      ? decodeBase64Image(item.b64_json)
      : typeof item.url === 'string' && item.url.trim()
        ? await downloadImage(this.network, new URL(item.url, endpoint).toString(), signal)
        : null;
    if (!buffer) throw providerUnavailable(`Image response item ${index + 1} has no image data.`);
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw providerUnavailable(`Image ${index + 1} exceeds the 20 MB limit.`);
    if (currentTotalBytes + buffer.byteLength > MAX_TOTAL_IMAGE_BYTES) {
      throw providerUnavailable('Generated images exceed the 50 MB total limit.');
    }
    const mimeType = detectSafeImageMimeType(buffer);
    if (!mimeType) throw providerUnavailable(`Image ${index + 1} has an unsupported format.`);
    const suffix = imageExtension(mimeType);
    const name = `generated-${index + 1}.${suffix}`;
    const storedImage = await this.generatedImages.create({ name, type: mimeType, data: buffer });
    let workspaceFile: ImageGenerationWorkspaceFile | undefined;
    try {
      workspaceFile = await this.writeWorkspaceImage(context, index, suffix, buffer);
    } catch (error) {
      await this.generatedImages.delete(storedImage.assetId).catch(() => undefined);
      throw error;
    }
    return {
      assetId: storedImage.assetId,
      attachment: {
        id: `generated_image_${safeIdPart(context.toolCallId ?? String(Date.now()))}_${index + 1}`,
        name,
        type: mimeType,
        size: buffer.byteLength,
        modelVisible: false,
        source: 'generated',
        assetId: storedImage.assetId,
      },
      ...(workspaceFile ? { workspaceFile } : {}),
    };
  }

  private async writeWorkspaceImage(
    context: ImageGenerationExecutionContext,
    index: number,
    suffix: string,
    buffer: Uint8Array,
  ): Promise<ImageGenerationWorkspaceFile | undefined> {
    const projectId = workspaceProjectId(context);
    if (!this.workspaceFiles || !projectId || context.permissionProfile === 'read-only') return undefined;
    const callId = safeIdPart(context.toolCallId ?? `image_${Date.now()}`);
    const file = await this.workspaceFiles.writeBinaryFile(
      projectId,
      `generated-images/${callId}-${index + 1}.${suffix}`,
      buffer,
    );
    return Object.freeze({ projectId, path: file.path.replace(/\\/gu, '/') });
  }

  private trackPendingAssets(context: ImageGenerationExecutionContext, assetIds: readonly string[]): void {
    const turnKey = generatedImageTurnKey(context);
    if (!turnKey) return;
    const pending = this.pendingAssetIdsByTurn.get(turnKey) ?? new Set<string>();
    for (const assetId of assetIds) pending.add(assetId);
    this.pendingAssetIdsByTurn.set(turnKey, pending);
  }

  private async retainQuickTestAssets(assetIds: readonly string[]): Promise<void> {
    this.quickTestAssetIds.push(...assetIds);
    const overflow = this.quickTestAssetIds.length - MAX_RETAINED_QUICK_TEST_ASSETS;
    if (overflow <= 0) return;
    const expired = this.quickTestAssetIds.splice(0, overflow);
    await Promise.allSettled(expired.map((assetId) => this.generatedImages.delete(assetId)));
  }
}

export function imageGenerationEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  url.search = '';
  url.hash = '';
  const pathname = url.pathname.replace(/\/+$/u, '');
  if (/\/images\/generations$/u.test(pathname)) url.pathname = pathname;
  else if (/\/v1$/u.test(pathname)) url.pathname = `${pathname}/images/generations`;
  else url.pathname = `${pathname}/v1/images/generations`.replace(/\/{2,}/gu, '/');
  return url.toString();
}

function settingsFailure(error: unknown): FeatureOperationFailure {
  if (error instanceof FeatureOperationFailure) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'REVISION_CONFLICT') {
    return new FeatureOperationFailure({
      code: 'REVISION_CONFLICT',
      message: 'Image generation settings changed. Reload before saving again.',
      retryable: true,
    });
  }
  return new FeatureOperationFailure({
    code: 'SETTINGS_UNAVAILABLE',
    message: 'Image generation settings are unavailable.',
    retryable: true,
  });
}

function unavailableForHealth(health: ImageGenerationHealth): FeatureOperationFailure {
  if (health === 'not-configured') {
    return new FeatureOperationFailure({
      code: 'FEATURE_NOT_CONFIGURED',
      message: 'Image generation service URL is not configured.',
      retryable: false,
    });
  }
  if (health === 'credentials-missing') {
    return new FeatureOperationFailure({
      code: 'CREDENTIALS_MISSING',
      message: 'Image generation credentials are missing.',
      retryable: false,
    });
  }
  if (health === 'provider-unavailable') return providerUnavailable('Image generation provider is unavailable.');
  return new FeatureOperationFailure({
    code: 'DEPENDENCY_UNAVAILABLE',
    message: 'Image generation settings could not be applied.',
    retryable: true,
  });
}

function providerUnavailable(message: string): FeatureOperationFailure {
  return new FeatureOperationFailure({ code: 'PROVIDER_UNAVAILABLE', message, retryable: true });
}

function invalidInput(message: string): FeatureOperationFailure {
  return new FeatureOperationFailure({ code: 'INVALID_INPUT', message, retryable: false });
}

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput('Image generation input must be an object.');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidInput(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalBoundedInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw invalidInput(`Expected an integer between ${min} and ${max}.`);
  }
  return value as number;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function combinedSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = (await readBoundedResponse(response, MAX_RESPONSE_BYTES, 'Image provider response is too large.')).toString('utf8');
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw providerUnavailable(`Image provider returned non-JSON content (HTTP ${response.status}).`);
  }
}

function openAiErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return `Image generation failed (HTTP ${status}): ${error.trim()}`;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return `Image generation failed (HTTP ${status}): ${message.trim()}`;
    }
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) return `Image generation failed (HTTP ${status}): ${detail.trim()}`;
  }
  return `Image generation failed (HTTP ${status}).`;
}

function imageResponseItems(payload: unknown): OpenAiImageResponseItem[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.filter((item): item is OpenAiImageResponseItem => Boolean(item && typeof item === 'object'))
    : [];
}

function redactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join('[REDACTED]') : value;
}

function decodeBase64Image(value: string): Buffer {
  const encoded = value.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/iu, '');
  if (encoded.length > MAX_ENCODED_IMAGE_CHARS) throw providerUnavailable('Generated image exceeds the 20 MB limit.');
  return Buffer.from(encoded, 'base64');
}

async function downloadImage(
  network: ImageGenerationNetwork,
  url: string,
  signal: AbortSignal,
): Promise<Buffer> {
  const response = await network.fetch(url, { signal });
  if (!response.ok) throw providerUnavailable(`Generated image download failed (HTTP ${response.status}).`);
  return readBoundedResponse(response, MAX_IMAGE_BYTES, 'Generated image exceeds the 20 MB limit.');
}

async function readBoundedResponse(response: Response, maxBytes: number, message: string): Promise<Buffer> {
  const announcedSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(announcedSize) && announcedSize > maxBytes) throw providerUnavailable(message);
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
        throw providerUnavailable(message);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

function detectSafeImageMimeType(buffer: Buffer): RuntimeRasterImageMimeType | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
}

function imageExtension(mimeType: RuntimeRasterImageMimeType): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length);
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, '_').slice(0, 120) || 'image';
}

function generatedImageTurnKey(context: ImageGenerationExecutionContext): string | null {
  return context.turnId ? `${context.threadId}\u0000${context.turnId}` : null;
}

function workspaceProjectId(context: ImageGenerationExecutionContext): string | undefined {
  return context.environment?.workspaceProjectId?.trim()
    || context.projectId?.trim()
    || context.environment?.id.trim()
    || undefined;
}

async function managedGeneratedImageAssetIdsFromStore(
  store: ImageGenerationReferenceReader,
  candidates: ReadonlySet<string>,
): Promise<Set<string>> {
  const retained = new Set<string>();
  const remaining = new Set(candidates);
  const threads = await store.listThreads({ includeArchived: true, includeSide: true });
  for (const thread of threads) {
    const snapshot = await store.getThread(thread.id);
    for (const message of snapshot?.messages ?? []) {
      for (const attachment of message.attachments ?? []) {
        const assetId = isRuntimeGeneratedMessageAttachment(attachment)
          ? attachment.assetId
          : isRuntimeInlineMessageAttachment(attachment)
            ? attachment.localAssetId
            : undefined;
        if (!assetId || !remaining.has(assetId)) continue;
        retained.add(assetId);
        remaining.delete(assetId);
      }
    }
    if (!remaining.size) break;
  }
  return retained;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'Image generation provider is unavailable.';
}
