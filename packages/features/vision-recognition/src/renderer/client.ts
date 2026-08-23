import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  readVisionRecognitionSettings,
  testVisionRecognition,
  updateVisionRecognitionSettings,
  type VisionRecognitionSettingsState,
  type VisionRecognitionSettingsUpdate,
  type VisionRecognitionTestInput,
  type VisionRecognitionTestResult,
} from '../contracts/index.js';

export type VisionRecognitionClient = Readonly<{
  readSettings(options?: Readonly<{ signal?: AbortSignal }>): Promise<VisionRecognitionSettingsState>;
  updateSettings(
    input: VisionRecognitionSettingsUpdate,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<VisionRecognitionSettingsState>;
  testModel(
    input: VisionRecognitionTestInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<VisionRecognitionTestResult>;
}>;

export function createVisionRecognitionClient(
  transport: FeatureOperationTransport,
): VisionRecognitionClient {
  return Object.freeze({
    readSettings: (options) => transport.call(readVisionRecognitionSettings, undefined, options),
    updateSettings: (input, options) => transport.call(updateVisionRecognitionSettings, input, options),
    testModel: (input, options) => transport.call(testVisionRecognition, input, options),
  });
}
