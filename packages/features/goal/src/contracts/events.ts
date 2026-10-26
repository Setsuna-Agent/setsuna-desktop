import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureEventContract } from '@setsuna-desktop/feature-core/events';
import { goalFeature } from './definition.js';
import { goalCompletionVerificationCodec, type GoalCompletionVerification } from './verification.js';
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
  state: GoalState,
  value: GoalState,
): GoalState {
  const verification = value.verification ?? (state.verification?.goalId === value.goal?.id
    && state.verification?.objective === value.goal?.objective ? state.verification : undefined);
  return goalStateCodec.parse({ ...value, ...(verification ? { verification } : {}) });
}

export const goalVerificationRecordedEvent = defineFeatureEventContract<GoalCompletionVerification>({
  featureId: goalFeature.id, eventType: 'goal.verification-recorded', currentVersion: 1,
  codecs: { 1: goalCompletionVerificationCodec }, migrate: (_version, value) => goalCompletionVerificationCodec.parse(value),
});

export function reduceGoalVerification(state: GoalState, verification: GoalCompletionVerification): GoalState {
  if (verification.goalId !== state.goal?.id || verification.objective !== state.goal.objective) return state;
  return Object.freeze({ ...state, verification });
}
