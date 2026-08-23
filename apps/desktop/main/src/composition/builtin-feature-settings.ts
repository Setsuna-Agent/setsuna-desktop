import type { ErasedFeatureSettingsDocumentDefinition } from '@setsuna-desktop/feature-core/settings';
import { imageGenerationSettings } from '@setsuna-desktop/feature-image-generation/contracts';
import { memorySettings } from '@setsuna-desktop/feature-memory/contracts';
import { visionRecognitionSettings } from '@setsuna-desktop/feature-vision-recognition/contracts';

/** Static management catalog used while the runtime execution graph is stopped. */
export const builtinFeatureSettingsDocuments = Object.freeze([
  ...imageGenerationSettings.erasedDocuments,
  ...memorySettings.erasedDocuments,
  ...visionRecognitionSettings.erasedDocuments,
] satisfies readonly ErasedFeatureSettingsDocumentDefinition[]);
