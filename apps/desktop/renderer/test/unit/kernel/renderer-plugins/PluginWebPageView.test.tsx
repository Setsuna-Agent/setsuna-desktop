// @vitest-environment happy-dom

import { parseRuntimePluginUiManifest, type RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { composeRendererMessages, declareRendererChildSlot, defineSingleRendererSlot } from '@setsuna-desktop/feature-core/renderer';
import { BrowserWorkspacePanel, browserRendererFeature } from '@setsuna-desktop/feature-browser/renderer';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { shellPluginPageSlot, shellRouteSlot, shellSidebarPluginEntrySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginRouteAdapter } from '../../../../src/app/layout/PluginRouteAdapter.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { activateDeclarativePluginUiGateway } from '../../../../src/kernel/declarative-plugin-ui/gateway.js';
import {
  RendererKernelProvider, RendererOwnedKeyedSlot, RendererOwnedListSlot,
  RendererOwnedSlotsProvider, RendererRootSingleSlot,
} from '../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

it('opens a sidebar web app through its page owner and registers a native browser without a chat context', async () => {
  const url = 'https://example.com/';
  const bridge = {
    getPasswordState: vi.fn(async () => null), onPasswordState: () => () => undefined,
    getExtensions: vi.fn(async () => []), onExtensionsChanged: () => () => undefined,
    getExtensionActions: vi.fn(async () => []), onExtensionActionsChanged: () => () => undefined,
    registerTab: vi.fn(async () => true), unregisterTab: vi.fn(async () => true),
    setActiveTab: vi.fn(async () => true), setDeviceEmulation: vi.fn(async () => true),
    cancelAnnotation: vi.fn(async () => undefined), setAnnotationMarkers: vi.fn(async () => true),
    onContextMenu: () => () => undefined, dismissContextMenu: vi.fn(async () => undefined),
  };
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true, value: { browser: bridge, links: { openExternal: vi.fn() } },
  });
  const plugin: RuntimePluginSummary = {
    id: 'web-app', name: 'Web app', installedAt: '2026-10-12T00:00:00Z',
    skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [],
    extension: {
      apiVersion: 1, runtime: 'node-worker', capabilities: ['ui'], trust: 'trusted',
      rendererUi: parseRuntimePluginUiManifest({
        schemaVersion: 2, actions: [], contributions: [{
          id: 'home.page', slot: 'renderer.plugin.page', navigation: { label: 'Web app' }, webpage: { url },
        }],
      }),
    },
  };
  const service = {
    getSnapshot: () => ({ plugins: [plugin], catalogRevision: 'fixture' }),
    refreshInstalled: async () => undefined, subscribe: () => () => undefined,
  } as unknown as PluginManagementRendererService;
  const runtime = createRendererPluginRuntime();
  const root = defineSingleRendererSlot<object>({ id: 'renderer.fixture.plugin-navigation', scope: 'app' });
  const owner = { pluginId: 'core.fixture', scopeId: 'shell' };
  runtime.declareRoot(owner, { slot: root, required: true });
  const ui = runtime.createRegistrar(owner);
  ui.single(root, {
    id: 'fixture.shell',
    children: [declareRendererChildSlot(shellSidebarPluginEntrySlot), declareRendererChildSlot(shellRouteSlot)],
    render: (_props, slots) => <RendererOwnedSlotsProvider slots={slots}><PluginNavigation /></RendererOwnedSlotsProvider>,
  });
  ui.keyed(shellRouteSlot, {
    id: 'fixture.plugin-route', key: 'plugin',
    children: [declareRendererChildSlot(shellPluginPageSlot, { fallback: { render: props => props.renderUnavailable() } })],
    render: ({ renderDefault }, slots) => <RendererOwnedSlotsProvider slots={slots}>{renderDefault()}</RendererOwnedSlotsProvider>,
  });
  // The chat route owns another Browser outlet; plugin pages must declare their own.
  ui.keyed(shellRouteSlot, {
    id: 'fixture.chat-route', key: 'chat', children: [declareRendererChildSlot(workspacePanelSlot)], render: () => null,
  });
  ui.keyed(workspacePanelSlot, {
    id: 'fixture.browser', key: 'browser', render: props => <BrowserWorkspacePanel {...props} />,
  });
  runtime.commitInitial();
  const disposeGateway = activateDeclarativePluginUiGateway(runtime, service, { refresh: async () => undefined });
  const messages = composeRendererMessages(hostMessages, [{ module: browserRendererFeature }]);

  try {
    render(<I18nProvider initialLocale="en-US" messageCatalog={messages}><ToastProvider>
      <RendererKernelProvider runtime={runtime}><RendererRootSingleSlot slot={root} props={{}} /></RendererKernelProvider>
    </ToastProvider></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Web app' }));
    await waitFor(() => expect(document.querySelector('webview')).not.toBeNull());
    const guest = document.querySelector('webview')!;
    expect(guest.getAttribute('src')).toBe(url);
    Object.assign(guest, {
      getWebContentsId: () => 42, getURL: () => url, getZoomFactor: () => 1,
      canGoBack: () => false, canGoForward: () => false,
    });
    fireEvent(guest, new Event('dom-ready'));
    fireEvent(guest, new Event('did-stop-loading'));
    await waitFor(() => expect(bridge.registerTab).toHaveBeenCalledExactlyOnceWith('plugin-web-web-app-home.page', 42, 'current-tab'));
    expect(runtime.getSnapshot().inspect().renderErrors).toEqual([]);

    await act(async () => { await disposeGateway(); });
    await waitFor(() => expect(bridge.unregisterTab).toHaveBeenCalledExactlyOnceWith('plugin-web-web-app-home.page', 42));
    expect(document.querySelector('webview')).toBeNull();
  } finally {
    cleanup();
    await disposeGateway();
    await runtime.dispose();
  }
});

function PluginNavigation() {
  const [viewKey, setViewKey] = useState<string | null>(null);
  return <>
    <RendererOwnedListSlot slot={shellSidebarPluginEntrySlot} props={{
      activeViewKey: viewKey, onOpen: setViewKey, onModifyApp: () => undefined, onViewPlugin: () => undefined,
    }} />
    {viewKey ? <RendererOwnedKeyedSlot entryKey="plugin" slot={shellRouteSlot} props={{
      routeId: 'plugin', renderDefault: () => <PluginRouteAdapter selectedViewKey={viewKey} onBack={() => setViewKey(null)} />,
    }} /> : null}
  </>;
}
