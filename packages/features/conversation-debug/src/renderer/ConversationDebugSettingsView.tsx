import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { useSyncExternalStore } from 'react';
import type { ConversationDebugRendererService } from './service.js';

export function ConversationDebugSettingsView({
  service,
  translate,
  ui,
}: Readonly<{
  service: ConversationDebugRendererService;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const state = useSyncExternalStore(service.subscribe, service.snapshot, service.snapshot);
  const { Group, Section, Toggle } = ui;
  return (
    <Section featureId="conversation-debug">
      <Group>
        <Toggle
          checked={state.enabled}
          description={state.error ?? translate('feature.conversationDebug.settings.description')}
          disabled={state.loading || state.saving || state.settings === null}
          label={translate('feature.conversationDebug.settings.label')}
          onChange={(enabled) => void service.setEnabled(enabled)}
        />
      </Group>
    </Section>
  );
}
