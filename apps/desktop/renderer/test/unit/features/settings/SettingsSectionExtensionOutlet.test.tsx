// @vitest-environment happy-dom

import {
  declareRendererChildSlot,
  defineSingleRendererSlot,
  type RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import {
  registerSettingsPageExtension,
  registerSettingsPage,
  settingsPageExtensionSlot,
  settingsPageSlot,
} from '@setsuna-desktop/renderer-contracts/settings';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RendererKernelProvider,
  RendererOwnedSlotsProvider,
  RendererRootSingleSlot,
} from '../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';
import { SettingsSectionExtensionOutlet } from '../../../../src/features/settings/SettingsSectionExtensionOutlet.js';
import { SettingsPage } from '../../../../src/features/settings/SettingsPage.js';
import { settingsViewUi } from '../../../../src/shared/ui/SettingsViewUi.js';
import { PageSessionProvider } from '@setsuna-desktop/renderer-ui';

describe('SettingsSectionExtensionOutlet', () => {
  afterEach(cleanup);

  it('restores sections and reading positions across route visits while honoring an explicit destination', async () => {
    const runtime = createSettingsFixtureRuntime();
    const tree = (visible = true, initialSection?: string) => <PageSessionProvider>
      <RendererKernelProvider runtime={runtime}>
        <RendererRootSingleSlot slot={settingsFixtureHostSlot} props={{ children: (
          visible ? <SettingsPage archivedThreads={[]} config={null} initialSection={initialSection} onSaveRuntimePreferences={vi.fn()}
            onDeleteAllArchivedThreads={vi.fn()} onDeleteArchivedThread={vi.fn()} onRestoreArchivedThread={vi.fn()} /> : null
        ) }} />
      </RendererKernelProvider></PageSessionProvider>;
    const view = render(tree());
    let viewport = view.container.querySelector<HTMLElement>('[data-settings-scroll-container]')!;
    viewport.scrollTop = 360;
    fireEvent.scroll(viewport);
    fireEvent.click(screen.getByRole('button', { name: '键盘快捷键' }));
    await screen.findByText('Shortcut settings');
    expect(viewport.scrollTop).toBe(0);

    viewport.scrollTop = 180;
    fireEvent.scroll(viewport);
    fireEvent.click(screen.getByRole('button', { name: '通用' }));
    await screen.findByText('General settings');
    expect(viewport.scrollTop).toBe(360);
    view.rerender(tree(false));
    view.rerender(tree());
    await screen.findByText('General settings');
    viewport = view.container.querySelector<HTMLElement>('[data-settings-scroll-container]')!;
    expect(viewport.scrollTop).toBe(360);
    view.rerender(tree(false));
    view.rerender(tree(true, 'shortcuts'));
    await screen.findByText('Shortcut settings');
    viewport = view.container.querySelector<HTMLElement>('[data-settings-scroll-container]')!;
    expect(viewport.scrollTop).toBe(180);
    view.unmount();
    await runtime.dispose();
  });

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
                scrollContainer={{ current: null }}
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

    fireEvent.click(screen.getByRole('button', { name: 'Personalization' }));

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
    children: [declareRendererChildSlot(settingsPageExtensionSlot), declareRendererChildSlot(settingsPageSlot)],
    render: ({ children }, slots) => (
      <RendererOwnedSlotsProvider slots={slots}>{children}</RendererOwnedSlotsProvider>
    ),
  });
  for (const [sectionId, titleKey, label] of [
    ['general', 'settings.section.general', 'General settings'],
    ['shortcuts', 'settings.section.shortcuts', 'Shortcut settings'],
  ] as const) {
    registerSettingsPage(runtime.createRegistrar(hostOwner), {
      entryId: `fixture.${sectionId}`, sectionId, titleKey, location: 'settings',
      navigationGroupId: 'preferences', order: 0, pageHeading: 'view', render: () => <div>{label}</div>,
    });
  }
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
      render: ({ onBack, ui }) => (
        <ui.PageLayout title="Memory preview" parent={{ label: 'Personalization', onBack }}>
          <span>Memory preview page</span>
        </ui.PageLayout>
      ),
    }],
  });
  runtime.commitInitial();
  return runtime;
}
