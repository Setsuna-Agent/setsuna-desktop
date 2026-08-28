import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  readThreadTitleGenerationSettings,
  updateThreadTitleGenerationSettings,
  type ThreadTitleGenerationSettingsState,
  type ThreadTitleGenerationSettingsUpdate,
} from '../contracts/index.js';

export type ThreadTitleGenerationClient = Readonly<{
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<ThreadTitleGenerationSettingsState>;
  updateSettings(
    input: ThreadTitleGenerationSettingsUpdate,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ThreadTitleGenerationSettingsState>;
}>;

export function createThreadTitleGenerationClient(
  transport: FeatureOperationTransport,
): ThreadTitleGenerationClient {
  return Object.freeze({
    readSettings: (options) => transport.call(readThreadTitleGenerationSettings, undefined, options),
    updateSettings: (input, options) => transport.call(updateThreadTitleGenerationSettings, input, options),
  });
}
