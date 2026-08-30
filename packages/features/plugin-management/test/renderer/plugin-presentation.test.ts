import type {
  RuntimePluginHook,
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { PluginManagementHook } from '../../src/contracts/index.js';
import {
  installedPluginsOutsideCatalog,
  matchingPluginHook,
  mergePluginSkills,
  pluginMatchesQuery,
} from '../../src/renderer/pluginPresentation.js';

describe('plugin presentation', () => {
  it('keeps local and orphaned marketplace installations outside the active catalog', () => {
    const marketplace = [marketplacePlugin('catalog')];
    const installed = [
      installedPlugin('catalog', 'marketplace'),
      installedPlugin('orphaned', 'marketplace'),
      installedPlugin('local', 'local'),
    ];

    expect(installedPluginsOutsideCatalog(installed, marketplace).map((plugin) => plugin.id)).toEqual([
      'orphaned',
      'local',
    ]);
  });

  it('searches nested capabilities and lets installed metadata override catalog entries', () => {
    const catalog = marketplacePlugin('tools');
    catalog.skills.push({ id: 'writer', name: 'Writer', description: 'Creates reports' });
    const installed = installedPlugin('tools', 'marketplace');
    installed.skills.push({ id: 'writer', name: 'Writer v2', description: 'Installed copy' });

    expect(pluginMatchesQuery(catalog, 'reports', installed)).toBe(true);
    expect(mergePluginSkills(catalog.skills, installed.skills, false)).toEqual([
      { id: 'writer', name: 'Writer v2', description: 'Installed copy' },
    ]);
  });

  it('matches pre-pluginHookId installs only when the event and matcher are unambiguous', () => {
    const item: RuntimePluginHook = {
      eventName: 'PreToolUse',
      id: 'guard-shell',
      matcher: 'shell',
      name: 'Guard shell',
    };
    const legacy = pluginHook({ pluginHookId: undefined });

    expect(matchingPluginHook([legacy], 'guard', item)).toBe(legacy);
    expect(matchingPluginHook([
      legacy,
      pluginHook({ managementId: 'duplicate', pluginHookId: undefined }),
    ], 'guard', item)).toBeUndefined();
  });
});

function marketplacePlugin(id: string): RuntimePluginMarketplaceItem {
  return {
    capabilities: { hooks: 0, mcpServers: 0, resources: 0, skills: 0 },
    featured: false,
    hooks: [],
    id,
    installed: false,
    mcpServers: [],
    name: id,
    resources: [],
    skills: [],
    tags: [],
    updateAvailable: false,
  };
}

function pluginHook(patch: Partial<PluginManagementHook> = {}): PluginManagementHook {
  return {
    command: 'guard-shell',
    currentHash: 'current-hash',
    displayOrder: 0,
    enabled: true,
    eventName: 'preToolUse',
    handlerType: 'command',
    isManaged: false,
    managementId: 'legacy-hook',
    matcher: 'shell',
    pluginId: 'guard',
    source: 'plugin',
    statusMessage: null,
    timeoutSec: 30,
    trustStatus: 'untrusted',
    ...patch,
  };
}

function installedPlugin(
  id: string,
  installationSource: RuntimePluginSummary['installationSource'],
): RuntimePluginSummary {
  return {
    hookCount: 0,
    hooks: [],
    id,
    installationSource,
    installedAt: '2026-01-01T00:00:00.000Z',
    mcpServers: [],
    name: id,
    resources: [],
    skills: [],
  };
}
