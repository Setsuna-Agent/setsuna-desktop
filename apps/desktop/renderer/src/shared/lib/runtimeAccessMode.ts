import type { RuntimeConfigInput, RuntimeConfigState } from '@setsuna-desktop/contracts';

export type RuntimeAccessMode =
  | 'request-approval'
  | 'agent-approval'
  | 'full-access';

export type RuntimeAccessModeSelection = Pick<RuntimeConfigInput, 'approvalPolicy' | 'permissionProfile'>;

export function runtimeAccessModeForConfig(
  config: Pick<RuntimeConfigState, 'approvalPolicy' | 'permissionProfile'>,
): RuntimeAccessMode {
  if (config.approvalPolicy === 'full' && config.permissionProfile === 'danger-full-access') return 'full-access';
  if (config.approvalPolicy === 'on-request' && config.permissionProfile === 'workspace-write') return 'agent-approval';
  return 'request-approval';
}

/** A visible access mode always persists both dimensions in one config update. */
export function runtimeAccessModeSelection(mode: RuntimeAccessMode): RuntimeAccessModeSelection {
  if (mode === 'request-approval') return { approvalPolicy: 'strict', permissionProfile: 'workspace-write' };
  if (mode === 'full-access') return { approvalPolicy: 'full', permissionProfile: 'danger-full-access' };
  return { approvalPolicy: 'on-request', permissionProfile: 'workspace-write' };
}
