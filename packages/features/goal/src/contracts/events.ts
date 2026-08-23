import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureEventContract } from '@setsuna-desktop/feature-core/events';
import { goalFeature } from './definition.js';
import {
  goalStateCodec,
  type GoalState,
} from './state.js';

export const goalStateReplacedEvent = defineFeatureEventContract<GoalState>({
  featureId: goalFeature.id,
  eventType: 'goal.state-replaced',
  currentVersion: 1,
  codecs: {
    1: defineRuntimeCodec((value) => goalStateCodec.parse(value)),
  },
  migrate: (_version, value) => goalStateCodec.parse(value),
});

export function reduceGoalState(
  _state: GoalState,
  value: GoalState,
): GoalState {
  return goalStateCodec.parse(value);
}
