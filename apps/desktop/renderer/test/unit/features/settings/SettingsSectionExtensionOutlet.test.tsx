// @vitest-environment happy-dom

import {
  declareRendererChildSlot,
  defineSingleRendererSlot,
  type RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import {
  registerSettingsPageExtension,
  settingsPageExtensionSlot,
} from '@setsuna-desktop/renderer-contracts/settings';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RendererKernelProvider,
  RendererOwnedSlotsProvider,
  RendererRootSingleSlot,
} from '../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';
import { SettingsSectionExtensionOutlet } from '../../../../src/features/settings/SettingsSectionExtensionOutlet.js';
import { settingsViewUi } from '../../../../src/shared/ui/SettingsViewUi.js';

describe('SettingsSectionExtensionOutlet', () => {
  afterEach(cleanup);

  it('replaces the parent section with a Feature subpage and restores it on back', () => {
    const runtime = createSettingsFixtureRuntime();
    const rendered = render(
      <RendererKernelProvider runtime={runtime}>
        <RendererRootSingleSlot
          slot={settingsFixtureHostSlot}
          props={{
            children: (
              <SettingsSectionExtensionOutlet
                sectionId="personalization"
                trailingContent={<div>Advanced settings</div>}
                translate={translate}
                ui={settingsViewUi}
              >
                <div>Personalization overview</div>
              </SettingsSectionExtensionOutlet>
            ),
          }}
        />
      </RendererKernelProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open memory preview' }));

    expect(screen.queryByText('Personalization overview')).toBeNull();
    expect(screen.queryByText('Advanced settings')).toBeNull();
    expect(screen.getByText('Memory preview page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to personalization' }));

    expect(screen.getByText('Personalization overview')).toBeTruthy();
    expect(screen.getByText('Advanced settings')).toBeTruthy();
    expect(screen.queryByText('Memory preview page')).toBeNull();
    rendered.unmount();
    void runtime.dispose();
  });
});

const translate: RendererTranslate = (key) => key;
const settingsFixtureHostSlot = defineSingleRendererSlot<Readonly<{ children: ReactNode }>>({
  id: 'renderer.fixture.settings-host',
  scope: 'app',
});

function createSettingsFixtureRuntime() {
  const runtime = createRendererPluginRuntime();
  const hostOwner = Object.freeze({ pluginId: 'core.fixture-host', scopeId: 'fixture:host' });
  runtime.declareRoot(hostOwner, { slot: settingsFixtureHostSlot, required: true });
  runtime.createRegistrar(hostOwner).single(settingsFixtureHostSlot, {
    id: 'fixture.settings-host',
    children: [declareRendererChildSlot(settingsPageExtensionSlot)],
    render: ({ children }, slots) => (
      <RendererOwnedSlotsProvider slots={slots}>{children}</RendererOwnedSlotsProvider>
    ),
  });
  registerSettingsPageExtension(runtime.createRegistrar({
    featureId: 'test-feature',
    pluginId: 'feature.test-feature',
    scopeId: 'fixture:test-feature',
  }), {
    entryId: 'test-feature.memory-settings',
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
  });
  runtime.commitInitial();
  return runtime;
}
