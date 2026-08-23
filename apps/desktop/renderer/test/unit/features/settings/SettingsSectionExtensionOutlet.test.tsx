// @vitest-environment happy-dom

import type {
  RegisteredSettingsSectionExtension,
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsSectionExtensionOutlet } from '../../../../src/features/settings/SettingsSectionExtensionOutlet.js';
import { settingsViewUi } from '../../../../src/shared/ui/SettingsViewUi.js';

describe('SettingsSectionExtensionOutlet', () => {
  afterEach(cleanup);

  it('replaces the parent section with a Feature subpage and restores it on back', () => {
    render(
      <SettingsSectionExtensionOutlet
        extensions={extensions}
        sectionId="personalization"
        translate={translate}
        ui={settingsViewUi}
      >
        <div>Personalization overview</div>
      </SettingsSectionExtensionOutlet>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open memory preview' }));

    expect(screen.queryByText('Personalization overview')).toBeNull();
    expect(screen.getByText('Memory preview page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to personalization' }));

    expect(screen.getByText('Personalization overview')).toBeTruthy();
    expect(screen.queryByText('Memory preview page')).toBeNull();
  });
});

const featureId = defineFeatureDefinition({ id: 'test-feature', version: '1.0.0' }).id;
const translate: RendererTranslate = (key) => key;
const extensions: readonly RegisteredSettingsSectionExtension[] = [{
  featureId,
  id: 'memory-preferences',
  order: 10,
  targetSectionId: 'personalization',
  render: ({ openSubpage }) => (
    <button type="button" onClick={() => openSubpage('preview')}>Open memory preview</button>
  ),
  subpages: [{
    id: 'preview',
    render: ({ onBack }) => (
      <div>
        <span>Memory preview page</span>
        <button type="button" onClick={onBack}>Back to personalization</button>
      </div>
    ),
  }],
}];
