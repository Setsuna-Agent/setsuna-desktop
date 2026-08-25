import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { FeatureSettingsRevisionConflictError } from '@setsuna-desktop/feature-core/settings';
import type { RuntimeFeatureSettingsDocumentHandle } from '@setsuna-desktop/feature-core/runtime';
import type {
  ConversationDebugControl,
  ConversationDebugRuntimeHost,
  ConversationDebugSettings,
  ConversationDebugSettingsPatch,
  ConversationDebugSettingsState,
  ConversationDebugSettingsUpdate,
  RuntimeDebugTraceInput,
  RuntimeDebugTraceList,
} from '../contracts/index.js';
import { InMemoryConversationDebugTraceStore } from './in-memory-conversation-debug-trace-store.js';

type ConversationDebugSettingsHandle = RuntimeFeatureSettingsDocumentHandle<
  ConversationDebugSettings,
  ConversationDebugSettings,
  ConversationDebugSettingsPatch,
  undefined
>;

export class RuntimeConversationDebugControl implements ConversationDebugControl {
  private isEnabled: boolean;
  private readonly traces: InMemoryConversationDebugTraceStore;

  constructor(
    private readonly settings: ConversationDebugSettingsHandle,
    host: Pick<ConversationDebugRuntimeHost, 'id' | 'now'>,
    initialSettings: ConversationDebugSettings,
  ) {
    this.isEnabled = initialSettings.enabled;
    this.traces = new InMemoryConversationDebugTraceStore(host);
  }

  enabled(): boolean {
    return this.isEnabled;
  }

  applySettings(value: ConversationDebugSettings): void {
    this.isEnabled = value.enabled;
  }

  append(input: RuntimeDebugTraceInput): void {
    if (this.isEnabled) this.traces.append(input);
  }

  listTraces(threadId: string, afterSeq = 0): RuntimeDebugTraceList {
    return this.traces.list(threadId, afterSeq);
  }

  async readSettings(): Promise<ConversationDebugSettingsState> {
    try {
      return await this.settings.readPublic();
    } catch (error) {
      throw settingsUnavailable(error);
    }
  }

  async updateSettings(input: ConversationDebugSettingsUpdate): Promise<ConversationDebugSettingsState> {
    try {
      return await this.settings.update(input);
    } catch (error) {
      if (error instanceof FeatureSettingsRevisionConflictError) {
        throw new FeatureOperationFailure({
          code: 'REVISION_CONFLICT',
          message: error.message,
          retryable: true,
        });
      }
      throw settingsUnavailable(error);
    }
  }
}

function settingsUnavailable(error: unknown): FeatureOperationFailure {
  return new FeatureOperationFailure({
    code: 'SETTINGS_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'Conversation debug settings are unavailable.',
    retryable: true,
  });
}
