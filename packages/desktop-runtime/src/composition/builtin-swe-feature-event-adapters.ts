import type {
  LegacyRuntimeGoalEvent,
  StoredFeatureEventEnvelope,
} from '@setsuna-desktop/contracts';
import { goalFeatureEventToLegacySweEvent } from '@setsuna-desktop/feature-goal/runtime';

type SweCompatibilityEvent = LegacyRuntimeGoalEvent;
type SweFeatureEventAdapter = (
  event: StoredFeatureEventEnvelope,
) => SweCompatibilityEvent | null;

const builtinSweFeatureEventAdapters = Object.freeze([
  goalFeatureEventToLegacySweEvent,
] satisfies readonly SweFeatureEventAdapter[]);

/** Static protocol compatibility catalog; adapters never write legacy events. */
export function mapBuiltinFeatureEventToSweCompatibilityEvent(
  event: StoredFeatureEventEnvelope,
): SweCompatibilityEvent | null {
  for (const adapter of builtinSweFeatureEventAdapters) {
    const mapped = adapter(event);
    if (mapped) return mapped;
  }
  return null;
}
