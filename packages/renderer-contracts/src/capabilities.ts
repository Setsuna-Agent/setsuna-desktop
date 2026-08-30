import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { Disposer } from '@setsuna-desktop/feature-core/scope';

export type CapabilitiesRefreshOwner = 'mcp' | 'plugin-management' | 'skills';
export type CapabilitiesRefreshOperation = () => Promise<unknown>;

/**
 * Cross-catalog invalidation without exposing one Feature service to another.
 * Mutations have already committed when this runs, so refresh failures are
 * reported by the host and never turn a successful mutation into a false error.
 */
export interface CapabilitiesRefreshCoordinator {
  register(owner: CapabilitiesRefreshOwner, refresh: CapabilitiesRefreshOperation): Disposer;
  refresh(owners: readonly CapabilitiesRefreshOwner[]): Promise<void>;
  refreshAll(): Promise<void>;
}

export const capabilitiesRefreshCoordinatorCapability: CapabilityToken<CapabilitiesRefreshCoordinator> = defineCapability({
  id: 'renderer.capabilities-refresh-coordinator',
  description: 'Best-effort invalidation across independent renderer capability catalogs',
});
