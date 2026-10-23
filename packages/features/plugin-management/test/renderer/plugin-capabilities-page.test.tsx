// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Button, ConfirmationProvider, IconButton } from '@setsuna-desktop/renderer-ui';
import type { CapabilitiesPageNavigation, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginManagementRendererService, PluginManagementSnapshot } from '../../src/contracts/index.js';
import { PluginCapabilitiesPage } from '../../src/renderer/PluginCapabilitiesPage.js';

afterEach(cleanup);

it('keeps plugin details and the error after a failed uninstall, then closes them after a successful retry', async () => {
  const plugin = { id: 'local-tools', name: 'Local tools', installationSource: 'local' as const,
    installedAt: '2026-01-01T00:00:00Z', hookCount: 0, hooks: [], skills: [], mcpServers: [], resources: [] };
  const snapshot: PluginManagementSnapshot = { catalogRevision: 'local', extensions: [], plugins: [plugin], marketplace: [], marketplaceErrors: [] };
  const hooks = { hooks: [] };
  const service = {
    getSnapshot: () => snapshot, getHookSnapshot: () => hooks, subscribe: () => () => undefined,
    refresh: vi.fn(async () => snapshot), refreshHooks: vi.fn(async () => hooks),
    remove: vi.fn().mockRejectedValueOnce(new Error('Plugin is busy')).mockResolvedValueOnce(undefined),
  } as unknown as PluginManagementRendererService;
  const ui = {
    Button, IconButton, PluginIcon: () => null,
    PageHeader: ({ title, actions }) => <header><h2>{title}</h2>{actions}</header>,
    ActionMenu: ({ items, onSelect }) => <>{items.map((item) => <Button key={item.id} disabled={item.disabled} onClick={() => onSelect(item.id)}>{item.label}</Button>)}</>,
    Toast: ({ message }) => <div role="alert">{message}</div>,
  } as SettingsViewUi;
  const capabilities: CapabilitiesPageNavigation = {
    activeItemId: plugin.id, catalogNavigation: null, catalogNavigationInPage: false, workspacePath: null,
    openChat: vi.fn(), openPluginChat: vi.fn(), renderBreadcrumb: () => null, renderCreateMenu: () => null,
    setActiveItemId: vi.fn(),
  };
  await act(async () => {
    render(<ConfirmationProvider><PluginCapabilitiesPage sectionId="plugins" service={service} ui={ui} capabilities={capabilities}
      capabilitiesRefresh={{ refresh: vi.fn() } as unknown as CapabilitiesRefreshCoordinator}
      openExternal={async () => true} translate={(key, params) => params?.detail ? String(params.detail) : key} /></ConfirmationProvider>);
  });
  const uninstall = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'feature.pluginManagement.uninstall' }));
    await act(async () => {
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'feature.pluginManagement.remove' }));
    });
  };
  await uninstall();
  expect(screen.getByRole('alert').textContent).toBe('Plugin is busy');
  expect(screen.getByRole('heading', { name: 'Local tools' })).toBeTruthy();
  await uninstall();
  expect(service.remove).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('heading', { name: 'Local tools' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(capabilities.setActiveItemId).toHaveBeenCalledWith(null);
});

it.each(['install', 'import', 'refresh'] as const)('reports a catalog %s failure through Toast and allows retry', async (operation) => {
  const snapshot: PluginManagementSnapshot = {
    catalogRevision: 'local', extensions: [], plugins: [], marketplaceErrors: [],
    marketplace: [{
      id: 'bundled', name: 'Local tools', tags: [], featured: true,
      skills: [], mcpServers: [], hooks: [], resources: [], installed: false, updateAvailable: false,
      capabilities: { skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
    }],
  };
  const hooks = { hooks: [] };
  const service = {
    getSnapshot: () => snapshot, getHookSnapshot: () => hooks, subscribe: () => () => undefined,
    refresh: vi.fn().mockRejectedValueOnce(new Error('Background repository unavailable')).mockResolvedValue(snapshot),
    refreshHooks: vi.fn(async () => hooks),
    installMarketplace: vi.fn(async () => undefined), installLocal: vi.fn(async () => undefined),
  };
  const Toast = vi.fn((_props: { message: string; tone?: string }) => null);
  await act(async () => {
    render(<PluginCapabilitiesPage
      sectionId="plugins" service={service as unknown as PluginManagementRendererService}
      capabilitiesRefresh={{ refresh: vi.fn() } as unknown as CapabilitiesRefreshCoordinator}
      openExternal={async () => true} translate={(key, params) => params?.detail ? String(params.detail) : key}
      ui={{ Button, IconButton, PluginIcon: () => null, Toast } as unknown as SettingsViewUi}
    />);
  });
  expect(Toast).not.toHaveBeenCalled();
  const method = operation === 'install' ? service.installMarketplace : operation === 'import' ? service.installLocal : service.refresh;
  method.mockRejectedValueOnce(new Error('Operation failed'));
  const button = screen.getByRole('button', { name: operation === 'install'
    ? 'feature.pluginManagement.install: Local tools' : `feature.pluginManagement.${operation}` });
  await act(async () => { fireEvent.click(button); });
  expect(Toast.mock.calls.at(-1)?.[0]).toMatchObject({ message: 'Operation failed', tone: 'error' });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  const callCount = method.mock.calls.length;
  await act(async () => { fireEvent.click(button); });
  expect(method).toHaveBeenCalledTimes(callCount + 1);
});

it('allows installing a bundled plugin during a manual OpenAI repository refresh', async () => {
  const snapshot: PluginManagementSnapshot = {
    catalogRevision: 'local', extensions: [], plugins: [], marketplaceErrors: [],
    marketplace: [{
      id: 'bundled', name: 'Local tools', tags: [], featured: true,
      skills: [], mcpServers: [], hooks: [], resources: [],
      installed: false, updateAvailable: false,
      capabilities: { skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
    }],
  };
  let finishRefresh!: (value: PluginManagementSnapshot) => void;
  const pendingRefresh = new Promise<PluginManagementSnapshot>((resolve) => { finishRefresh = resolve; });
  const hooks = { hooks: [] };
  const service = {
    getSnapshot: () => snapshot,
    getHookSnapshot: () => hooks,
    subscribe: () => () => undefined,
    refresh: vi.fn().mockResolvedValueOnce(snapshot).mockReturnValueOnce(pendingRefresh),
    refreshHooks: vi.fn(async () => hooks),
    installMarketplace: vi.fn(async () => ({ plugin: { id: 'bundled' } })),
  } as unknown as PluginManagementRendererService;
  const refreshCapabilities = vi.fn(async () => undefined);
  await act(async () => {
    render(<PluginCapabilitiesPage
      sectionId="plugins"
      service={service}
      capabilitiesRefresh={{ refresh: refreshCapabilities } as unknown as CapabilitiesRefreshCoordinator}
      openExternal={async () => true}
      translate={(key) => key}
      ui={{ Button, IconButton, PluginIcon: () => null } as unknown as SettingsViewUi}
    />);
  });

  const refreshButton = screen.getByRole('button', { name: 'feature.pluginManagement.refresh' });
  await act(async () => { fireEvent.click(refreshButton); });
  expect((refreshButton as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('heading', { name: 'feature.pluginManagement.marketplace.repository' })).toBeTruthy();
  expect(screen.getByText('Local tools')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'feature.pluginManagement.install: Local tools' }));
  });
  expect(service.installMarketplace).toHaveBeenCalledWith({ pluginId: 'bundled' });
  expect(refreshCapabilities).toHaveBeenCalledWith(['skills', 'mcp']);

  await act(async () => { finishRefresh(snapshot); await pendingRefresh; });
  expect((refreshButton as HTMLButtonElement).disabled).toBe(false);
});
