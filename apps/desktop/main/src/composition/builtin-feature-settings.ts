import type { ErasedFeatureSettingsDocumentDefinition } from '@setsuna-desktop/feature-core/settings';
import { imageGenerationSettings } from '@setsuna-desktop/feature-image-generation/contracts';
import { visionRecognitionSettings } from '@setsuna-desktop/feature-vision-recognition/contracts';

/** Static management catalog used while the runtime execution graph is stopped. */
export const builtinFeatureSettingsDocuments = Object.freeze([
  ...imageGenerationSettings.erasedDocuments,
  ...visionRecognitionSettings.erasedDocuments,
] satisfies readonly ErasedFeatureSettingsDocumentDefinition[]);
