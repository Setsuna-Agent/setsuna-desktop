import type { RuntimeFeatureMount } from '@setsuna-desktop/feature-core/runtime';
import { mountRuntimeFeature } from '@setsuna-desktop/feature-core/runtime';
import { browserRuntimeFeature } from '@setsuna-desktop/feature-browser/runtime';
import { imageGenerationRuntimeFeature } from '@setsuna-desktop/feature-image-generation/runtime';
import { goalRuntimeFeature } from '@setsuna-desktop/feature-goal/runtime';
import { visionRecognitionRuntimeFeature } from '@setsuna-desktop/feature-vision-recognition/runtime';

/**
 * The explicit runtime Feature catalog. Business Features are added here only
 * after their package owns a complete vertical slice.
 */
export const builtinRuntimeFeatures = [
  mountRuntimeFeature(browserRuntimeFeature, { criticality: 'required' }),
  mountRuntimeFeature(imageGenerationRuntimeFeature, { criticality: 'optional' }),
  mountRuntimeFeature(goalRuntimeFeature, { criticality: 'optional' }),
  mountRuntimeFeature(visionRecognitionRuntimeFeature, { criticality: 'optional' }),
] as const satisfies readonly RuntimeFeatureMount[];
