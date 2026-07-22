import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import {
  runtimeAccessModeForConfig,
  runtimeAccessModeSelection,
  type RuntimeAccessModeSelection,
} from '../../../shared/lib/runtimeAccessMode.js';
import { RuntimeAccessModeMenu } from '../../../shared/ui/RuntimeAccessModeMenu.js';

export function ChatApprovalPolicyMenu({
  disabled,
  approvalPolicy,
  permissionProfile,
  onChange,
}: {
  disabled?: boolean;
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  permissionProfile: RuntimeConfigState['permissionProfile'];
  onChange: (selection: RuntimeAccessModeSelection) => void;
}) {
  const activeMode = runtimeAccessModeForConfig({ approvalPolicy, permissionProfile });
  return (
    <RuntimeAccessModeMenu
      disabled={disabled}
      mode={activeMode}
      onChange={(mode) => onChange(runtimeAccessModeSelection(mode))}
    />
  );
}
