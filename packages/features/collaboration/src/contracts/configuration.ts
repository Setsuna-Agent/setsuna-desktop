import type { RuntimeConfigState } from '@setsuna-desktop/contracts';

/** The canonical switch wins over the legacy alias so a stale alias cannot bypass an explicit disable. */
export function collaborationEnabledForConfig(config: Pick<RuntimeConfigState, 'features'> | null | undefined): boolean {
  return config?.features?.multi_agent ?? config?.features?.multi_agent_v2 ?? true;
}
