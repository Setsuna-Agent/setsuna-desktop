import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { reviewFeature } from '../contracts/index.js';
import { reviewMessages } from './messages.js';
import './styles/review.css';

export const reviewRendererFeature = defineRendererFeature({
  definition: reviewFeature,
  dependencies: defineRendererDependencies({}),
  messages: [reviewMessages],
  setup: () => undefined,
});
