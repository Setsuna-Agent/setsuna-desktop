import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { useState } from 'react';
import { collaborationEnabledForConfig } from '../contracts/index.js';

export function CollaborationToggleSettings({ features, onSave, translate: t, ui }: Readonly<{
  features: Record<string, boolean> | undefined;
  onSave(features: Record<string, boolean>): Promise<void>;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveEnabled = async (enabled: boolean) => {
    setSaving(true);
    setSaveError(null);
    try {
      const next: Record<string, boolean> = { ...features, multi_agent: enabled };
      delete next.multi_agent_v2;
      await onSave(next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ui.Group>
      <ui.Toggle
        label={t('feature.collaboration.settings.enabled')}
        description={t('feature.collaboration.settings.enabledDescription')}
        checked={collaborationEnabledForConfig({ features })}
        disabled={saving}
        onChange={(enabled) => void saveEnabled(enabled)}
      />
      {saveError ? <ui.Toast message={saveError} /> : null}
    </ui.Group>
  );
}
