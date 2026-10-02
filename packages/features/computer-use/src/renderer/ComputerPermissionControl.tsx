import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { ArrowUpRight } from 'lucide-react';
import type { ComputerPermission, ComputerPermissionStatus } from '../contracts/index.js';

export function ComputerPermissionControl({ permission, status, available, requesting, onRequest, translate, ui }: Readonly<{
  permission: ComputerPermission;
  status: ComputerPermissionStatus;
  available: boolean;
  requesting: ComputerPermission | null;
  onRequest(permission: ComputerPermission): void;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const needsPermission = available && status !== 'granted' && status !== 'not-required' && status !== 'unsupported';
  const opening = requesting === permission;
  const { Button } = ui;
  return (
    <div className="computer-use-permission-control">
      <span className="computer-use-permission-badge" data-status={status} role="status">
        <span className="computer-use-permission-badge__dot" aria-hidden="true" />
        {translate(`feature.computerUse.permission.${status}`)}
      </span>
      {needsPermission ? (
        <Button
          className="computer-use-permission-action"
          variant="ghost"
          disabled={requesting !== null}
          aria-busy={opening}
          aria-label={translate(`feature.computerUse.authorize.${permission}`)}
          onClick={() => onRequest(permission)}
        >
          {translate(opening ? 'feature.computerUse.authorizing' : 'feature.computerUse.authorize')}
          <ArrowUpRight size={13} aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
