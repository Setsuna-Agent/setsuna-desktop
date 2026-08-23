import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  readImageGenerationSettings,
  testImageGenerationConnection,
  updateImageGenerationSettings,
  type ImageGenerationSettingsState,
  type ImageGenerationSettingsUpdate,
  type ImageGenerationTestInput,
  type ImageGenerationTestResult,
} from '../contracts/index.js';

export type ImageGenerationClient = Readonly<{
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<ImageGenerationSettingsState>;
  updateSettings(
    input: ImageGenerationSettingsUpdate,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ImageGenerationSettingsState>;
  testConnection(
    input: ImageGenerationTestInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ImageGenerationTestResult>;
}>;

export function createImageGenerationClient(
  transport: FeatureOperationTransport,
): ImageGenerationClient {
  return Object.freeze({
    readSettings: (options) => transport.call(readImageGenerationSettings, undefined, options),
    updateSettings: (input, options) => transport.call(updateImageGenerationSettings, input, options),
    testConnection: (input, options) => transport.call(testImageGenerationConnection, input, options),
  });
}
