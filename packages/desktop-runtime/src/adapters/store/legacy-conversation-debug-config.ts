import {
  LEGACY_CONVERSATION_DEBUG_FEATURE_FLAG,
  type ConversationDebugSettings,
} from '@setsuna-desktop/feature-conversation-debug/contracts';

export function conversationDebugSettingsFromLegacy(value: unknown): ConversationDebugSettings {
  const features = featureFlags(value);
  return Object.freeze({ enabled: features[LEGACY_CONVERSATION_DEBUG_FEATURE_FLAG] === true });
}

export function retireLegacyConversationDebugSettings(value: unknown): Readonly<{
  changed: boolean;
  value: Record<string, boolean>;
}> {
  const features = featureFlags(value);
  if (!Object.hasOwn(features, LEGACY_CONVERSATION_DEBUG_FEATURE_FLAG)) {
    return Object.freeze({ changed: false, value: features });
  }
  delete features[LEGACY_CONVERSATION_DEBUG_FEATURE_FLAG];
  return Object.freeze({ changed: true, value: features });
}

export function normalizeLegacyFreeFeatureFlags(value: unknown): Record<string, boolean> {
  return retireLegacyConversationDebugSettings(value).value;
}

export function conversationDebugFeatureFlagsForSave(
  value: unknown,
  previousValue: unknown,
): Record<string, boolean> {
  const features = normalizeLegacyFreeFeatureFlags(value);
  const previousFeatures = featureFlags(previousValue);
  // The legacy flag remains migration input until the owning Feature explicitly retires it.
  if (Object.hasOwn(previousFeatures, LEGACY_CONVERSATION_DEBUG_FEATURE_FLAG)) {
    features[LEGACY_CONVERSATION_DEBUG_FEATURE_FLAG] = previousFeatures[LEGACY_CONVERSATION_DEBUG_FEATURE_FLAG]!;
  }
  return features;
}

function featureFlags(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
}
