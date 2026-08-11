import type { DesktopWindowsSandboxState } from '@setsuna-desktop/contracts';
import { Download, RefreshCw, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../../shared/i18n/messages.js';
import { Button, StatusBadge } from '../../../shared/ui/primitives.js';
import { useWindowsSandbox } from './useWindowsSandbox.js';

const STATUS_LABEL_KEYS: Record<DesktopWindowsSandboxState, MessageKey> = {
  'needs-repair': 'settings.windowsSandbox.status.needsRepair',
  'not-installed': 'settings.windowsSandbox.status.notInstalled',
  ready: 'settings.windowsSandbox.status.ready',
  unavailable: 'settings.windowsSandbox.status.unavailable',
  unsupported: 'settings.windowsSandbox.status.unsupported',
};

export function WindowsSandboxSettings() {
  const { t } = useI18n();
  const sandbox = useWindowsSandbox();
  const busy = sandbox.busyAction !== null;
  const status = sandbox.status;

  const uninstall = () => {
    if (window.confirm(t('settings.windowsSandbox.uninstallConfirm'))) {
      void sandbox.runAction('uninstall');
    }
  };

  return (
    <div className="chat-user-settings__section-block windows-sandbox-settings">
      <div className="chat-user-settings__group-title">{t('settings.windowsSandbox.title')}</div>
      <div
        className="chat-user-settings__group chat-user-settings__runtime-card windows-sandbox-settings__card"
        aria-busy={busy}
      >
        <div className="chat-user-settings__row windows-sandbox-settings__status-row">
          <span className="chat-user-settings__runtime-policy-copy">
            <ShieldCheck className="windows-sandbox-settings__icon" aria-hidden="true" />
            <span>
              <strong>{t('settings.windowsSandbox.nativeProvider')}</strong>
              <small>{statusDescription(status?.state, status?.reason, t)}</small>
            </span>
          </span>
          <div className="windows-sandbox-settings__status" aria-live="polite">
            {status ? (
              <StatusBadge tone={statusTone(status.state)}>
                {t(STATUS_LABEL_KEYS[status.state])}
              </StatusBadge>
            ) : null}
            <div className="windows-sandbox-settings__actions">
              <Button
                icon={<RefreshCw className={sandbox.busyAction === 'refresh' ? 'is-spinning' : ''} size={14} />}
                disabled={busy}
                onClick={() => void sandbox.refresh()}
              >
                {sandbox.busyAction === 'refresh'
                  ? t('settings.windowsSandbox.checking')
                  : t('settings.windowsSandbox.check')}
              </Button>
              {status?.state === 'not-installed' ? (
                <Button
                  icon={<Download size={14} />}
                  disabled={busy || !status.installSupported}
                  onClick={() => void sandbox.runAction('install')}
                >
                  {sandbox.busyAction === 'install'
                    ? t('settings.windowsSandbox.installing')
                    : t('settings.windowsSandbox.install')}
                </Button>
              ) : null}
              {status?.state === 'needs-repair' ? (
                <Button
                  icon={<Wrench size={14} />}
                  disabled={busy || !status.installSupported}
                  onClick={() => void sandbox.runAction('repair')}
                >
                  {sandbox.busyAction === 'repair'
                    ? t('settings.windowsSandbox.repairing')
                    : t('settings.windowsSandbox.repair')}
                </Button>
              ) : null}
              {status && ['ready', 'needs-repair'].includes(status.state) ? (
                <Button
                  icon={<Trash2 size={14} />}
                  variant="danger"
                  disabled={busy}
                  onClick={uninstall}
                >
                  {sandbox.busyAction === 'uninstall'
                    ? t('settings.windowsSandbox.uninstalling')
                    : t('settings.windowsSandbox.uninstall')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="windows-sandbox-settings__details">
          <span>{t('settings.windowsSandbox.boundary')}</span>
          {status?.sidecarVersion ? (
            <code>{t('settings.windowsSandbox.version', { version: status.sidecarVersion })}</code>
          ) : null}
        </div>
        {sandbox.error ? (
          <div className="chat-user-settings__runtime-error" role="alert">{sandbox.error}</div>
        ) : null}
      </div>
    </div>
  );
}

function statusDescription(
  state: DesktopWindowsSandboxState | undefined,
  reason: string | undefined,
  t: Translate,
): string {
  if (!state) return t('settings.windowsSandbox.loading');
  if (reason) return reason;
  if (state === 'ready') return t('settings.windowsSandbox.readyDescription');
  return t('settings.windowsSandbox.defaultDescription');
}

function statusTone(state: DesktopWindowsSandboxState): 'danger' | 'neutral' | 'success' | 'warning' {
  if (state === 'ready') return 'success';
  if (state === 'needs-repair') return 'warning';
  if (state === 'unavailable') return 'danger';
  return 'neutral';
}
