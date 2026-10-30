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
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RendererKernelProvider,
  RendererOwnedSlotsProvider,
  RendererRootSingleSlot,
} from '../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';
import { SettingsSectionExtensionOutlet } from '../../../../src/features/settings/SettingsSectionExtensionOutlet.js';
import { SettingsPage } from '../../../../src/features/settings/SettingsPage.js';
import type { SettingsPageLocation } from '../../../../src/features/settings/settings-types.js';
import { settingsViewUi } from '../../../../src/shared/ui/SettingsViewUi.js';
import { appRouteTopbarSlotId } from '../../../../src/shared/ui/AppRouteTopbarPortal.js';
import { useAppNavigationHistory } from '../../../../src/app/controller/useAppNavigationHistory.js';
import { AppThreadHistoryNavigation } from '../../../../src/app/layout/AppThreadHistoryNavigation.js';
import { PageSessionProvider } from '@setsuna-desktop/renderer-ui';
import { DEFAULT_BROWSER_PREFERENCES, type BrowserDesktopBridge } from '@setsuna-desktop/feature-browser/contracts';
import { BrowserSettingsPage } from '../../../../../../../packages/features/browser/src/renderer/settings/BrowserSettingsPage.js';
import { BrowserSettingsNavigationProvider } from '../../../../../../../packages/features/browser/src/renderer/settings/context.js';
import { translateBrowserMessage, type BrowserTranslate } from '../../../../../../../packages/features/browser/src/renderer/messages.js';

describe('SettingsSectionExtensionOutlet', () => {
  afterEach(cleanup);

  it('restores sections and reading positions across route visits while honoring an explicit destination', async () => {
    const runtime = createSettingsFixtureRuntime();
    let location: SettingsPageLocation = { sectionId: 'general', path: [] };
    const navigate = (next: SettingsPageLocation) => { location = next; view.rerender(tree()); };
    const tree = (visible = true) => <PageSessionProvider>
      <RendererKernelProvider runtime={runtime}>
        <RendererRootSingleSlot slot={settingsFixtureHostSlot} props={{ children: (
          visible ? <SettingsPage archivedThreads={[]} config={null} location={location} onNavigate={navigate} onSaveRuntimePreferences={vi.fn()}
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
    location = { sectionId: 'shortcuts', path: [] };
    view.rerender(tree());
    await screen.findByText('Shortcut settings');
    viewport = view.container.querySelector<HTMLElement>('[data-settings-scroll-container]')!;
    expect(viewport.scrollTop).toBe(180);
    view.unmount();
    await runtime.dispose();
  });

  it('replays browser subpages and linked settings sections through global history, including after settings unmounts', async () => {
    let openSettings!: (section: string) => void;
    const runtime = createSettingsFixtureRuntime((section) => openSettings(section));
    const onError = vi.fn();
    function Workbench() {
      const [activeView, setActiveView] = useState<'chat' | 'settings'>('chat');
      const [settingsLocation, setSettingsLocation] = useState<SettingsPageLocation>({ sectionId: 'general', path: [] });
      openSettings = (next) => { setSettingsLocation({ sectionId: next, path: [] }); setActiveView('settings'); };
      const history = useAppNavigationHistory({
        location: activeView === 'settings'
          ? { view: 'settings', ...settingsLocation }
          : { view: 'chat', threadId: 'thread-a', projectId: null },
        onNavigate: async (location) => {
          if (location.view === 'settings') {
            setSettingsLocation({ sectionId: location.sectionId, path: location.path });
            setActiveView('settings');
          }
          else setActiveView('chat');
        },
        onError,
      });
      return <PageSessionProvider><RendererKernelProvider runtime={runtime}>
        <AppThreadHistoryNavigation canGoBack={history.canGoBack} canGoForward={history.canGoForward}
          onGoBack={history.goBack} onGoForward={history.goForward} />
        <button onClick={() => openSettings('browser')}>Open browser settings</button>
        <button onClick={() => setActiveView('chat')}>Open conversation</button>
        <RendererRootSingleSlot slot={settingsFixtureHostSlot} props={{ children: activeView === 'settings' ? (
          <SettingsPage archivedThreads={[]} config={null} location={settingsLocation} onNavigate={setSettingsLocation}
            onSaveRuntimePreferences={vi.fn()} onDeleteAllArchivedThreads={vi.fn()}
            onDeleteArchivedThread={vi.fn()} onRestoreArchivedThread={vi.fn()} />
        ) : <span>Conversation</span> }} />
      </RendererKernelProvider></PageSessionProvider>;
    }
    const view = render(<Workbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Open browser settings' }));
    await screen.findByRole('heading', { name: 'Browser' });
    const viewport = view.container.querySelector<HTMLElement>('[data-settings-scroll-container]')!;
    viewport.scrollTop = 240;
    fireEvent.scroll(viewport);

    fireEvent.click(screen.getByRole('button', { name: 'Import data' }));
    await screen.findByRole('heading', { name: 'Import data' });
    viewport.scrollTop = 120;
    fireEvent.scroll(viewport);
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await screen.findByRole('heading', { name: 'Browser' });
    expect(viewport.scrollTop).toBe(240);
    fireEvent.click(screen.getByRole('button', { name: '前进' }));
    await screen.findByRole('heading', { name: 'Import data' });
    expect(viewport.scrollTop).toBe(120);

    // A subpage is a restorable destination even after its Feature has unmounted.
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
    await screen.findByText('Conversation');
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await screen.findByRole('heading', { name: 'Import data' });
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await screen.findByRole('heading', { name: 'Browser' });
    const restoredViewport = view.container.querySelector<HTMLElement>('[data-settings-scroll-container]')!;
    expect(restoredViewport.scrollTop).toBe(240);

    fireEvent.click(screen.getByRole('button', { name: 'Network proxy' }));
    await screen.findByText('Proxy settings');

    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await screen.findByRole('heading', { name: 'Browser' });
    expect(screen.queryByText('Conversation')).toBeNull();
    expect(restoredViewport.scrollTop).toBe(240);
    fireEvent.click(screen.getByRole('button', { name: '前进' }));
    await screen.findByText('Proxy settings');
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await screen.findByRole('heading', { name: 'Browser' });

    // Sidebar selections use the same state and replace the old forward branch.
    fireEvent.click(screen.getByRole('button', { name: '键盘快捷键' }));
    await screen.findByText('Shortcut settings');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '前进' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await screen.findByRole('heading', { name: 'Browser' });
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await screen.findByText('Conversation');
    fireEvent.click(screen.getByRole('button', { name: '前进' }));
    await screen.findByRole('heading', { name: 'Browser' });
    fireEvent.click(screen.getByRole('button', { name: 'Import data' }));
    await screen.findByRole('heading', { name: 'Import data' });
    fireEvent.click(screen.getByRole('button', { name: 'Browser' }));
    await screen.findByRole('heading', { name: 'Browser' });
    expect(onError).not.toHaveBeenCalled();
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
const translateBrowser: BrowserTranslate = (key) => translateBrowserMessage('en-US', key);
const settingsFixtureHostSlot = defineSingleRendererSlot<Readonly<{ children: ReactNode }>>({
  id: 'renderer.fixture.settings-host',
  scope: 'app',
});

function createSettingsFixtureRuntime(onOpenSettings?: (section: string) => void) {
  const runtime = createRendererPluginRuntime();
  const hostOwner = Object.freeze({ pluginId: 'core.fixture-host', scopeId: 'fixture:host' });
  runtime.declareRoot(hostOwner, { slot: settingsFixtureHostSlot, required: true });
  runtime.createRegistrar(hostOwner).single(settingsFixtureHostSlot, {
    id: 'fixture.settings-host',
    children: [declareRendererChildSlot(settingsPageExtensionSlot), declareRendererChildSlot(settingsPageSlot)],
    render: ({ children }, slots) => (
      <RendererOwnedSlotsProvider slots={slots}>
        <div id={appRouteTopbarSlotId} />
        {children}
      </RendererOwnedSlotsProvider>
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
  if (onOpenSettings) {
    const bridge = {
      getBrowserPreferences: vi.fn().mockResolvedValue(DEFAULT_BROWSER_PREFERENCES),
      onBrowserPreferencesChanged: () => () => undefined,
      listBrowserImportProfiles: vi.fn().mockResolvedValue([]),
    } as unknown as BrowserDesktopBridge;
    for (const sectionId of ['browser', 'network-proxy']) {
      registerSettingsPage(runtime.createRegistrar(hostOwner), {
        entryId: `fixture.${sectionId}`, sectionId, titleKey: `fixture.${sectionId}`, location: 'settings',
        navigationGroupId: 'workspace', order: 0, pageHeading: 'view',
        render: ({ ui }) => sectionId === 'browser'
          ? <BrowserSettingsNavigationProvider value={{ openSettings: onOpenSettings, openPage: vi.fn() }}>
            <BrowserSettingsPage bridge={bridge} translate={translateBrowser} ui={ui} />
          </BrowserSettingsNavigationProvider>
          : <span>Proxy settings</span>,
      });
    }
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
