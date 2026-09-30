import { runtimeAccessModeSelection, type RuntimeConfigState } from '@setsuna-desktop/contracts';

/** A task policy is scoped to one turn and reapplied after each settings refresh. */
export function runtimeConfigForTurn(config: RuntimeConfigState | null | undefined, unattended: boolean | undefined) {
  if (!config || !unattended) return config;
  return {
    ...config, ...runtimeAccessModeSelection('full-access'),
    features: { ...config.features, default_mode_request_user_input: false },
  };
}
