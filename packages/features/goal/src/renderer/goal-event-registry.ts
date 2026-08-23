import { FeatureEventRegistry } from '@setsuna-desktop/feature-core/events';
import {
  goalFeature,
  goalStateReplacedEvent,
  reduceGoalState,
  type GoalState,
} from '../contracts/index.js';

/** Renderer-local reducer table; runtime owns a separate registry using the same contract. */
export function createRendererGoalEventRegistry(): FeatureEventRegistry<GoalState> {
  const registry = new FeatureEventRegistry<GoalState>(goalFeature.id);
  registry.register(goalStateReplacedEvent, reduceGoalState);
  return registry;
}
