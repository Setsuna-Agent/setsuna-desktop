import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { RefreshCw } from 'lucide-react';
import type { ComputerBridge, ComputerPermission } from '../contracts/index.js';
import { ComputerPermissionControl } from './ComputerPermissionControl.js';
import { useComputerSettings } from './useComputerSettings.js';
import './computer-use.css';

const permissionRows: ComputerPermission[] = ['screen', 'accessibility'];

export function ComputerSettingsView({ bridge, translate, ui }: Readonly<{
  bridge: ComputerBridge;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { settings, saving, requesting, error, refresh, setEnabled, requestPermission } = useComputerSettings(bridge);
  const { Section, PageHeading, Group, Toggle, Row, IconButton, Toast } = ui;
  return (
    <Section featureId="computer-use">
      <PageHeading
        title={translate('feature.computerUse.title')}
        action={(
          <IconButton label={translate('feature.computerUse.refresh')} disabled={saving} onClick={() => void refresh()}>
            <RefreshCw size={16} />
          </IconButton>
        )}
      />
      <Group>
        <Toggle
          label={translate('feature.computerUse.enabled')}
          description={null}
          checked={settings?.enabled ?? false}
          disabled={!settings || saving}
          onChange={(enabled) => void setEnabled(enabled)}
        />
      </Group>
      <Group title={translate('feature.computerUse.permissions')}>
        {permissionRows.map((permission) => (
          <Row key={permission} label={translate(`feature.computerUse.${permission}`)}>
            <ComputerPermissionControl
              permission={permission}
              status={settings?.permissions[permission] ?? 'unknown'}
              available={settings !== null}
              requesting={requesting}
              onRequest={(value) => void requestPermission(value)}
              translate={translate}
              ui={ui}
            />
          </Row>
        ))}
      </Group>
      {error ? <Toast message={error} tone="error" /> : null}
    </Section>
  );
}
