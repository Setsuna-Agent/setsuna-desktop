import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import {
  MemoryPreferencesSettingsView,
  MemoryTaskModelSettingsView,
  type MemoryClient,
} from '@setsuna-desktop/feature-memory/renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { settingsViewUi } from '../../../../src/shared/ui/SettingsViewUi.js';

describe('Feature Settings UI', () => {
  it('renders Memory preferences through host-owned settings controls', () => {
    const html = renderToStaticMarkup(
      <MemoryPreferencesSettingsView
        client={unusedClient}
        translate={translate}
        ui={settingsViewUi}
        onOpenPreview={() => undefined}
      />,
    );

    expect(html).toContain('data-feature-id="memory"');
    expect(html).toContain('chat-user-settings__section');
    expect(html.match(/class="sd-check"/g)).toHaveLength(3);
    expect(html).not.toContain('sd-select-field');
    expect(html).toContain('sd-button');
    expect(html).toContain('sd-settings-navigation-row');
    expect(html).toContain('feature.memory.settings.title');
    expect(html).toContain('feature.memory.settings.preview');
    expect(html).toContain('feature.memory.settings.view');
    expect(html).not.toContain('feature.memory.settings.description');
  });

  it('renders Memory task models as a separate host-owned settings group', () => {
    const html = renderToStaticMarkup(
      <MemoryTaskModelSettingsView client={unusedClient} translate={translate} ui={settingsViewUi} />,
    );

    expect(html).toContain('data-feature-id="memory"');
    expect(html.match(/\bsd-select-field\b/g)).toHaveLength(2);
    expect(html).not.toContain('class="sd-check"');
    expect(html).toContain('feature.memory.settings.title');
    expect(html).toContain('feature.memory.settings.extractionModelDescription');
    expect(html).toContain('feature.memory.settings.consolidationModelDescription');
  });
});

const translate: RendererTranslate = (key) => key;

const unusedClient: MemoryClient = {
  readSettings: async () => { throw new Error('Effects do not run during static rendering.'); },
  updateSettings: async () => { throw new Error('Static rendering must not update settings.'); },
  preview: async () => { throw new Error('Static rendering must not load a preview.'); },
  delete: async () => undefined,
  clear: async () => undefined,
};
