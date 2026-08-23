import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfiguredModelReference,
  RuntimeMessage,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type {
  FeatureSettingsDiagnosis,
  RuntimeFeatureSettingsDocumentHandle,
} from '@setsuna-desktop/feature-core/settings';
import type { FeatureHealthReporter } from '@setsuna-desktop/feature-core/status';
import {
  VISION_RECOGNITION_PROMPT_MAX_CHARS,
  type VisionRecognitionHealth,
  type VisionRecognitionModelOption,
  type VisionRecognitionModelSelection,
  type VisionRecognitionResolvedImage,
  type VisionRecognitionResult,
  type VisionRecognitionRuntimeHost,
  type VisionRecognitionService,
  type VisionRecognitionSettingsState,
  type VisionRecognitionSettingsUpdate,
  type VisionRecognitionTestInput,
  type VisionRecognitionTestResult,
} from '../contracts/index.js';

const MAX_RESULT_CHARS = 64_000;
const MAX_OUTPUT_TOKENS = 4_096;
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

type SelectionHandle = RuntimeFeatureSettingsDocumentHandle<
  VisionRecognitionModelSelection,
  VisionRecognitionModelSelection,
  VisionRecognitionModelSelection,
  undefined
>;

type AppliedVisionModel = Readonly<{
  revision: number;
  signature: string;
  reference: RuntimeConfiguredModelReference;
  provider: ProviderConfigState;
  model: ProviderModelConfig;
}>;

export class RuntimeVisionRecognitionService implements VisionRecognitionService {
  private applied: AppliedVisionModel | null = null;
  private availableModels: readonly VisionRecognitionModelOption[] = Object.freeze([]);
  private health: VisionRecognitionHealth = 'not-configured';
  private refreshTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly scope: FeatureScope,
    private readonly settings: SelectionHandle,
    private readonly host: VisionRecognitionRuntimeHost,
    private readonly healthReporter: FeatureHealthReporter,
    private readonly diagnose: () => Promise<FeatureSettingsDiagnosis>,
  ) {}

  async initialize(): Promise<void> {
    await this.refreshAppliedModel();
    this.scope.add(this.settings.subscribeRuntime(() => {
      void this.queueRefresh();
    }));
  }

  isAvailable(): Promise<boolean> {
    return this.scope.runOperation(async () => {
      await this.queueRefresh();
      return this.applied !== null;
    });
  }

  readSettings(): Promise<VisionRecognitionSettingsState> {
    return this.scope.runOperation(async () => {
      await this.queueRefresh();
      return this.readSettingsInternal();
    });
  }

  updateSettings(input: VisionRecognitionSettingsUpdate): Promise<VisionRecognitionSettingsState> {
    return this.scope.runOperation(async () => {
      try {
        await this.settings.update({
          expectedRevision: input.expectedRevision,
          patch: input.selection,
        });
        await this.queueRefresh();
        return this.readSettingsInternal();
      } catch (error) {
        throw settingsFailure(error);
      }
    });
  }

  diagnoseSettings(): Promise<FeatureSettingsDiagnosis> {
    return this.diagnose();
  }

  testRecognition(
    input: VisionRecognitionTestInput,
    signal?: AbortSignal,
  ): Promise<VisionRecognitionTestResult> {
    return this.scope.runOperation(async (operationSignal) => {
      if (!await this.host.isMarketplacePluginInstalled()) {
        throw operationFailure(
          'PLUGIN_NOT_INSTALLED',
          'Vision recognition marketplace plugin is not installed.',
          false,
        );
      }
      const prompt = validatedPrompt(input.prompt);
      const selection = await this.selectedModel();
      const startedAt = this.host.now().getTime();
      const content = await this.analyzeImage(selection, prompt, {
        id: 'vision_recognition_test_image',
        name: 'vision-recognition-test.png',
        mimeType: 'image/png',
        data: Buffer.from(TEST_IMAGE_BASE64, 'base64'),
      }, operationSignal);
      return Object.freeze({
        content,
        durationMs: Math.max(0, this.host.now().getTime() - startedAt),
        model: selection.model.code,
      });
    }, { signal });
  }

  analyze(input: unknown, context: Readonly<{
    threadId: string;
    turnId?: string;
    signal?: AbortSignal;
  }>): Promise<VisionRecognitionResult> {
    return this.scope.runOperation(async (operationSignal) => {
      const selection = await this.selectedModel();
      const args = objectInput(input);
      const attachmentId = requiredString(args.attachment_id, 'attachment_id');
      const prompt = validatedPrompt(requiredString(args.prompt, 'prompt'));
      const image = await this.host.resolveImage(context.threadId, attachmentId);
      const content = await this.analyzeImage(
        selection,
        prompt,
        image,
        operationSignal,
        context.turnId ? { threadId: context.threadId, turnId: context.turnId } : undefined,
      );
      return Object.freeze({
        content,
        attachmentId: image.id,
        attachmentName: image.name,
        providerId: selection.reference.providerId,
        modelId: selection.reference.modelId,
        model: selection.model.code,
      });
    }, { signal: context.signal });
  }

  private async readSettingsInternal(): Promise<VisionRecognitionSettingsState> {
    try {
      const current = await this.settings.readPublic();
      return Object.freeze({
        selection: current.value,
        revision: current.revision,
        appliedRevision: this.applied?.revision ?? null,
        availableModels: this.availableModels,
        health: this.health,
      });
    } catch (error) {
      throw settingsFailure(error);
    }
  }

  private queueRefresh(): Promise<void> {
    const refresh = this.refreshTail.then(() => this.refreshAppliedModel());
    this.refreshTail = refresh.catch(() => undefined);
    return refresh;
  }

  private async refreshAppliedModel(): Promise<void> {
    try {
      const [current, providers] = await Promise.all([
        this.settings.read(),
        this.host.listProviders(),
      ]);
      this.availableModels = availableVisionModels(providers);
      if (!current.value) {
        this.setUnavailable(
          'not-configured',
          'VISION_RECOGNITION_NOT_CONFIGURED',
          'Vision recognition model is not configured.',
        );
        return;
      }
      const selected = selectVisionModel(providers, current.value);
      if (!selected) {
        this.setUnavailable(
          'model-unavailable',
          'VISION_RECOGNITION_MODEL_UNAVAILABLE',
          'The selected vision recognition model is unavailable.',
        );
        return;
      }
      const signature = appliedSignature(current.revision, selected.provider, selected.model);
      const preserveProviderFailure = this.health === 'provider-unavailable'
        && this.applied?.signature === signature;
      this.applied = Object.freeze({
        revision: current.revision,
        signature,
        reference: current.value,
        ...selected,
      });
      if (!preserveProviderFailure) this.markReady();
    } catch {
      this.setUnavailable(
        'settings-invalid',
        'VISION_RECOGNITION_SETTINGS_INVALID',
        'Vision recognition settings could not be applied.',
      );
    }
  }

  private async selectedModel(): Promise<AppliedVisionModel> {
    await this.queueRefresh();
    if (this.applied) return this.applied;
    if (this.health === 'not-configured') {
      throw operationFailure('FEATURE_NOT_CONFIGURED', 'Vision recognition model is not configured.', false);
    }
    throw operationFailure('MODEL_UNAVAILABLE', 'The selected vision recognition model is unavailable.', true);
  }

  private async analyzeImage(
    selection: AppliedVisionModel,
    prompt: string,
    image: VisionRecognitionResolvedImage,
    signal?: AbortSignal,
    usageContext?: Readonly<{ threadId: string; turnId: string }>,
  ): Promise<string> {
    let result: Awaited<ReturnType<VisionRecognitionRuntimeHost['generateText']>>;
    try {
      result = await this.host.generateText({
        providerId: selection.reference.providerId,
        model: selection.model.code,
        messages: [visionRequestMessage(prompt, image, this.host.now())],
        maxOutputTokens: Math.min(selection.model.maxOutputTokens, MAX_OUTPUT_TOKENS),
        tools: [],
        toolChoice: 'none',
        maxResultChars: MAX_RESULT_CHARS,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      this.markProviderUnavailable(selection);
      throw operationFailure(
        'PROVIDER_UNAVAILABLE',
        'Vision recognition provider is unavailable.',
        true,
      );
    }
    const content = result.content.trim();
    if (!content) {
      this.markProviderUnavailable(selection);
      throw operationFailure('PROVIDER_UNAVAILABLE', 'Vision model returned no usable text.', true);
    }
    if (usageContext && result.usage) {
      await this.recordUsage(result.usage, selection, usageContext);
    }
    if (this.applied?.signature === selection.signature) this.markReady();
    return content;
  }

  private async recordUsage(
    usage: RuntimeUsage,
    selection: AppliedVisionModel,
    context: Readonly<{ threadId: string; turnId: string }>,
  ): Promise<void> {
    await this.host.recordUsage({
      ...usage,
      ...context,
      createdAt: this.host.now().toISOString(),
      providerId: usage.providerId ?? selection.reference.providerId,
      provider: usage.provider ?? selection.provider.name,
      model: usage.model ?? selection.model.code,
    });
  }

  private setUnavailable(health: VisionRecognitionHealth, code: string, message: string): void {
    this.applied = null;
    this.health = health;
    this.healthReporter.markDegraded({ code, message });
  }

  private markReady(): void {
    this.health = 'ready';
    this.healthReporter.markActive();
  }

  private markProviderUnavailable(selection: AppliedVisionModel): void {
    if (this.applied?.signature !== selection.signature) return;
    this.health = 'provider-unavailable';
    this.healthReporter.markDegraded({
      code: 'VISION_RECOGNITION_PROVIDER_UNAVAILABLE',
      message: 'Vision recognition provider is unavailable.',
    });
  }
}

function availableVisionModels(providers: readonly ProviderConfigState[]): readonly VisionRecognitionModelOption[] {
  return Object.freeze(providers.flatMap((provider) => {
    if (!provider.enabled) return [];
    return provider.models.flatMap((model) => (
      model.enabled && model.supportsImages && model.id.trim() && model.code.trim()
        ? [Object.freeze({
            providerId: provider.id,
            providerName: provider.name || provider.id,
            modelId: model.id,
            modelName: model.name || model.code,
            modelCode: model.code,
          })]
        : []
    ));
  }));
}

function selectVisionModel(
  providers: readonly ProviderConfigState[],
  reference: RuntimeConfiguredModelReference,
): Readonly<{ provider: ProviderConfigState; model: ProviderModelConfig }> | null {
  const provider = providers.find((item) => item.enabled && item.id === reference.providerId);
  const model = provider?.models.find((item) => item.id === reference.modelId);
  if (!provider || !model?.enabled || !model.supportsImages || !model.code.trim()) return null;
  return Object.freeze({ provider, model });
}

function appliedSignature(
  revision: number,
  provider: ProviderConfigState,
  model: ProviderModelConfig,
): string {
  return JSON.stringify([
    revision,
    provider.id,
    provider.baseUrl,
    provider.apiKeySet,
    provider.proxyRoute,
    model.id,
    model.code,
    model.maxOutputTokens,
  ]);
}

function visionRequestMessage(
  prompt: string,
  image: VisionRecognitionResolvedImage,
  now: Date,
): RuntimeMessage {
  return {
    id: 'vision_recognition_request',
    role: 'user',
    content: prompt,
    createdAt: now.toISOString(),
    status: 'complete',
    attachments: [{
      id: image.id,
      name: image.name,
      type: image.mimeType,
      size: image.data.byteLength,
      source: 'inline',
      modelVisible: true,
      url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`,
    }],
  };
}

function validatedPrompt(value: string): string {
  const prompt = requiredString(value, 'prompt');
  if (prompt.length > VISION_RECOGNITION_PROMPT_MAX_CHARS) {
    throw operationFailure(
      'INVALID_INPUT',
      `Prompt must not exceed ${VISION_RECOGNITION_PROMPT_MAX_CHARS} characters.`,
      false,
    );
  }
  return prompt;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw operationFailure('INVALID_INPUT', `${name} is required.`, false);
  }
  return value.trim();
}

function settingsFailure(error: unknown): FeatureOperationFailure {
  if (error instanceof FeatureOperationFailure) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'REVISION_CONFLICT') {
    return operationFailure(
      'REVISION_CONFLICT',
      'Vision recognition settings changed. Reload before saving again.',
      true,
    );
  }
  return operationFailure(
    'SETTINGS_UNAVAILABLE',
    'Vision recognition settings are unavailable.',
    true,
  );
}

function operationFailure(
  code: string,
  message: string,
  retryable: boolean,
): FeatureOperationFailure {
  return new FeatureOperationFailure({ code, message, retryable });
}
