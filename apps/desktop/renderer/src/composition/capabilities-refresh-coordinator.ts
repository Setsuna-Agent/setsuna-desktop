import type {
  CapabilitiesRefreshCoordinator,
  CapabilitiesRefreshOperation,
  CapabilitiesRefreshOwner,
} from '@setsuna-desktop/renderer-contracts/capabilities';
import { reportRuntimeBackgroundFailure } from '../services/runtime-client/runtimeClientErrors.js';

const owners: readonly CapabilitiesRefreshOwner[] = Object.freeze([
  'mcp',
  'plugin-management',
  'skills',
]);

export function createCapabilitiesRefreshCoordinator(): CapabilitiesRefreshCoordinator {
  const operations = new Map<CapabilitiesRefreshOwner, CapabilitiesRefreshOperation>();

  const refresh = async (requestedOwners: readonly CapabilitiesRefreshOwner[]) => {
    const uniqueOwners = [...new Set(requestedOwners)];
    const results = await Promise.allSettled(uniqueOwners.map(async (owner) => {
      const operation = operations.get(owner);
      if (operation) await operation();
    }));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        reportRuntimeBackgroundFailure(
          `${uniqueOwners[index]} capabilities refresh`,
          result.reason,
        );
      }
    });
  };

  return Object.freeze({
    register(owner: CapabilitiesRefreshOwner, operation: CapabilitiesRefreshOperation) {
      if (operations.has(owner)) throw new Error(`Capabilities refresh owner already registered: ${owner}`);
      operations.set(owner, operation);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        if (operations.get(owner) === operation) operations.delete(owner);
      };
    },
    refresh,
    refreshAll: () => refresh(owners),
  });
}
