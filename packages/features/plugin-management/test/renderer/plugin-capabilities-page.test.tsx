// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginManagementRendererService, PluginManagementSnapshot } from '../../src/contracts/index.js';
import { PluginCapabilitiesPage } from '../../src/renderer/PluginCapabilitiesPage.js';

afterEach(cleanup);

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
