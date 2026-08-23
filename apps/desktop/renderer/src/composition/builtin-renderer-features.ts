import type { RendererFeatureMount } from '@setsuna-desktop/feature-core/renderer';
import { mountRendererFeature } from '@setsuna-desktop/feature-core/renderer';
import { browserRendererFeature } from '@setsuna-desktop/feature-browser/renderer';
import { collaborationRendererFeature } from '@setsuna-desktop/feature-collaboration/renderer';
import { imageGenerationRendererFeature } from '@setsuna-desktop/feature-image-generation/renderer';
import { goalRendererFeature } from '@setsuna-desktop/feature-goal/renderer';
import { terminalRendererFeature } from '@setsuna-desktop/feature-terminal/renderer';
import { visionRecognitionRendererFeature } from '@setsuna-desktop/feature-vision-recognition/renderer';

/** Renderer Features are intentionally explicit so bundling and ownership stay reviewable. */
export const builtinRendererFeatures = [
  mountRendererFeature(browserRendererFeature, { criticality: 'required' }),
  mountRendererFeature(collaborationRendererFeature, { criticality: 'optional' }),
  mountRendererFeature(imageGenerationRendererFeature, { criticality: 'optional' }),
  mountRendererFeature(goalRendererFeature, { criticality: 'optional' }),
  mountRendererFeature(terminalRendererFeature, { criticality: 'required' }),
  mountRendererFeature(visionRecognitionRendererFeature, { criticality: 'optional' }),
] as const satisfies readonly RendererFeatureMount[];
