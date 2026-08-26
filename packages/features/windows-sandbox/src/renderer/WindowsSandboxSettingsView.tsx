import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { Download, RefreshCw, Trash2, Wrench } from 'lucide-react';
import type {
  DesktopWindowsSandboxState,
  WindowsSandboxDesktopBridge,
} from '../contracts/index.js';
import { useWindowsSandbox } from './controller.js';
import './windows-sandbox.css';

const STATUS_LABEL_KEYS: Record<DesktopWindowsSandboxState, `feature.${string}`> = {
  'needs-repair': 'feature.windowsSandbox.settings.status.needsRepair',
  'not-installed': 'feature.windowsSandbox.settings.status.notInstalled',
  ready: 'feature.windowsSandbox.settings.status.ready',
  unavailable: 'feature.windowsSandbox.settings.status.unavailable',
  unsupported: 'feature.windowsSandbox.settings.status.unsupported',
};

type WindowsSandboxSettingsViewProps = Readonly<{
  bridge: WindowsSandboxDesktopBridge | null;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>;

export function WindowsSandboxSettingsView({
  bridge,
  translate,
  ui,
}: WindowsSandboxSettingsViewProps) {
  const sandbox = useWindowsSandbox(bridge);
  const busy = sandbox.busyAction !== null;
  const status = sandbox.status;
  const description = statusDescription(status?.state, status?.reason, translate);
  const { Button, Group, Row, Section } = ui;

  const uninstall = () => {
    if (window.confirm(translate('feature.windowsSandbox.settings.uninstallConfirm'))) {
      void sandbox.runAction('uninstall');
    }
  };

  return (
    <Section className="feature-windows-sandbox" featureId="windows-sandbox">
      <Group title={translate('feature.windowsSandbox.settings.title')}>
        <Row
          className="feature-windows-sandbox__status-row"
          label={(
            <span className="feature-windows-sandbox__summary">
              <span className="feature-windows-sandbox__heading">
                <span>{translate('feature.windowsSandbox.settings.nativeProvider')}</span>
                {status ? (
                  <span
                    className={`feature-windows-sandbox__status is-${statusTone(status.state)}`}
                    aria-atomic="true"
                    aria-live="polite"
                    aria-label={translate(STATUS_LABEL_KEYS[status.state])}
                    role="status"
                    title={translate(STATUS_LABEL_KEYS[status.state])}
                  />
                ) : null}
              </span>
              {description ? <small>{description}</small> : null}
            </span>
          )}
        >
          <div className="feature-windows-sandbox__actions" aria-busy={busy}>
            <Button
              icon={<RefreshCw className={sandbox.busyAction === 'refresh' ? 'is-spinning' : ''} size={14} />}
              disabled={busy}
              onClick={() => void sandbox.refresh()}
            >
              {translate(sandbox.busyAction === 'refresh'
                ? 'feature.windowsSandbox.settings.checking'
                : 'feature.windowsSandbox.settings.check')}
            </Button>
            {status?.state === 'not-installed' ? (
              <Button
                icon={<Download size={14} />}
                disabled={busy || !status.installSupported}
                onClick={() => void sandbox.runAction('install')}
              >
                {translate(sandbox.busyAction === 'install'
                  ? 'feature.windowsSandbox.settings.installing'
                  : 'feature.windowsSandbox.settings.install')}
              </Button>
            ) : null}
            {status?.state === 'needs-repair' ? (
              <Button
                icon={<Wrench size={14} />}
                disabled={busy || !status.installSupported}
                onClick={() => void sandbox.runAction('repair')}
              >
                {translate(sandbox.busyAction === 'repair'
                  ? 'feature.windowsSandbox.settings.repairing'
                  : 'feature.windowsSandbox.settings.repair')}
              </Button>
            ) : null}
            {status && ['ready', 'needs-repair'].includes(status.state) ? (
              <Button
                icon={<Trash2 size={14} />}
                variant="danger"
                disabled={busy}
                onClick={uninstall}
              >
                {translate(sandbox.busyAction === 'uninstall'
                  ? 'feature.windowsSandbox.settings.uninstalling'
                  : 'feature.windowsSandbox.settings.uninstall')}
              </Button>
            ) : null}
          </div>
        </Row>
      </Group>
      {sandbox.error ? <p className="feature-windows-sandbox__error" role="alert">{sandbox.error}</p> : null}
    </Section>
  );
}

function statusDescription(
  state: DesktopWindowsSandboxState | undefined,
  reason: string | undefined,
  translate: RendererTranslate,
): string | null {
  if (!state) return null;
  if (state === 'ready' || state === 'not-installed') return null;
  if (reason) return reason;
  return translate('feature.windowsSandbox.settings.defaultDescription');
}

function statusTone(state: DesktopWindowsSandboxState): 'danger' | 'neutral' | 'success' | 'warning' {
  if (state === 'ready') return 'success';
  if (state === 'needs-repair') return 'warning';
  if (state === 'unavailable') return 'danger';
  return 'neutral';
}
