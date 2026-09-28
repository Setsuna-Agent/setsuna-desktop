// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { RuntimePluginSummary } from '@setsuna-desktop/contracts';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginManagementRendererService, PluginManagementSnapshot } from '../../src/contracts/index.js';
import { InstalledPluginsSidebar } from '../../src/renderer/InstalledPluginsSidebar.js';

afterEach(cleanup);

it('opens repository and local plugin details with their correct IDs and follows install-state changes', () => {
  const repositoryPlugin = plugin('github-local', 'GitHub', {
    installationSource: 'repository',
    repository: { marketplaceId: 'github@catalog', url: 'https://example.com/plugins', path: 'github', revision: 'main' },
  });
  const localPlugin = plugin('local-tools', 'Local tools');
  let snapshot: PluginManagementSnapshot = {
    catalogRevision: 'installed', extensions: [], marketplace: [], marketplaceErrors: [],
    plugins: [localPlugin, repositoryPlugin],
  };
  const listeners = new Set<() => void>();
  const service = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as PluginManagementRendererService;
  const onSelectPlugin = vi.fn();
  const props = {
    service, selectedPluginId: null, onSelectPlugin,
    translate: (key: string) => key,
    ui: { Button, PluginIcon: () => null } as unknown as SettingsViewUi,
  };
  const view = render(<InstalledPluginsSidebar {...props} query="github" />);
  fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));
  expect(onSelectPlugin).toHaveBeenLastCalledWith('github@catalog');
  expect(screen.queryByRole('button', { name: 'Local tools' })).toBeNull();

  view.rerender(<InstalledPluginsSidebar {...props} query="" />);
  fireEvent.click(screen.getByRole('button', { name: 'Local tools' }));
  expect(onSelectPlugin).toHaveBeenLastCalledWith('local-tools');

  act(() => {
    snapshot = { ...snapshot, plugins: [localPlugin, plugin('new-tools', 'New tools')] };
    for (const listener of listeners) listener();
  });
  expect(screen.queryByRole('button', { name: 'GitHub' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New tools' }));
  expect(onSelectPlugin).toHaveBeenLastCalledWith('new-tools');
  view.unmount();
  expect(listeners.size).toBe(0);
});

function plugin(id: string, name: string, overrides: Partial<RuntimePluginSummary> = {}): RuntimePluginSummary {
  return {
    id, name, installedAt: '2026-09-28T00:00:00Z', installationSource: 'local',
    skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [], ...overrides,
  };
}
