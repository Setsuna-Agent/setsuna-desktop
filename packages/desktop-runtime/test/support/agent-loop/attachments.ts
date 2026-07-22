import type {
  ModelRequest,
  ModelStreamEvent
} from '@setsuna-desktop/contracts';
import type { ConfigStore, RuntimeProviderConfig } from '../../../src/ports/config-store.js';
import type { ModelClient } from '../../../src/ports/model-client.js';


export class BrowserScreenshotModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_browser_screenshot', name: 'browser_screenshot', arguments: '{}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'screenshot inspected' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ReasoningModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'reasoning_delta', text: 'plan' };
    yield { type: 'text_delta', text: 'answer' };
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ImageCapabilityConfigStore implements ConfigStore {
  constructor(private readonly supportsImages: boolean) {}

  async getConfig() {
    const model = this.model();
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'vision-provider',
      providers: [{
        id: 'vision-provider',
        name: 'Vision provider',
        provider: 'openai-compatible' as const,
        baseUrl: 'http://127.0.0.1:11434/v1',
        enabled: true,
        apiKeySet: false,
        apiKeyPreview: '',
        models: [model],
      }],
      globalPrompt: '',
      memory: {
        useMemories: true,
        generateMemories: true,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    const model = this.model();
    return {
      id: 'vision-provider',
      name: 'Vision provider',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      enabled: true,
      apiKey: '',
      models: [model],
      activeModel: model,
    };
  }

  private model() {
    return {
      id: 'vision-model',
      name: 'Vision model',
      code: 'vision-model',
      enabled: true,
      maxOutputTokens: 1000,
      thinkingEnabled: false,
      thinkingEfforts: [],
      supportsImages: this.supportsImages,
    };
  }
}