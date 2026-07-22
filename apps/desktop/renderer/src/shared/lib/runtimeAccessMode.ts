import type { RuntimeConfigInput, RuntimeConfigState } from '@setsuna-desktop/contracts';

export type RuntimeAccessMode =
  | 'request-approval'
  | 'agent-approval'
  | 'full-access';

export type RuntimeAccessModeSelection = Pick<RuntimeConfigInput, 'approvalPolicy' | 'permissionProfile'>;

export const runtimeAccessModeOptions: ReadonlyArray<{
  description: string;
  label: string;
  value: RuntimeAccessMode;
}> = [
  {
    value: 'request-approval',
    label: '请求批准',
    description: '编辑外部文件和使用互联网时始终询问',
  },
  {
    value: 'agent-approval',
    label: '替我审批',
    description: '仅对检测到的风险操作请求批准',
  },
  {
    value: 'full-access',
    label: '完全访问',
    description: '不受限制地访问互联网和电脑上的任何文件',
  },
];

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
