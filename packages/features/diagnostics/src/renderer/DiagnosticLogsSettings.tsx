import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { FolderOpen } from 'lucide-react';
import type { DiagnosticLogsBridge } from '../contracts/index.js';
import { useDiagnosticLogs } from './useDiagnosticLogs.js';

export function DiagnosticLogsSettings({ bridge, translate, ui }: Readonly<{
  bridge: DiagnosticLogsBridge;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { directory, opening, openDirectory } = useDiagnosticLogs(bridge, translate);
  return (
    <ui.Section featureId="diagnostics">
      <ui.Group>
        <ui.Row label={translate('feature.diagnostics.directory')} description={directory ?? undefined}>
          <ui.Button icon={<FolderOpen size={14} />} disabled={opening} onClick={() => void openDirectory()}>
            {translate(opening ? 'feature.diagnostics.opening' : 'feature.diagnostics.openDirectory')}
          </ui.Button>
        </ui.Row>
      </ui.Group>
    </ui.Section>
  );
}
