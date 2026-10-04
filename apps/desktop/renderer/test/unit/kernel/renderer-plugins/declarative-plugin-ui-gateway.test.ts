import {
  parseRuntimePluginUiManifest,
  type RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import type { RendererPluginDefinition } from '@setsuna-desktop/feature-core/renderer';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { settingsPageSlot } from '@setsuna-desktop/renderer-contracts/settings';
import {
  shellPluginPageSlot,
  shellSidebarPluginEntrySlot,
} from '@setsuna-desktop/renderer-contracts/shell';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import {
  activateDeclarativePluginUiGateway,
  assertHostAllowedContribution,
  rendererPluginIdentity,
} from '../../../../src/kernel/declarative-plugin-ui/gateway.js';
import type { RendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';

describe('declarative Plugin UI gateway', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])('returns before a slow catalog refresh and owns late mounts (closed=%s)', async (closeBeforeRefresh) => {
    let finishRefresh!: () => void;
    let refreshSignal: AbortSignal | undefined;
    const pendingRefresh = new Promise<void>((resolve) => { finishRefresh = resolve; });
    const disposeMount = vi.fn();
    const mount = vi.fn(async () => disposeMount);
    const unsubscribe = vi.fn();
    const service = {
      getSnapshot: () => ({ plugins: [installedUiPlugin()], catalogRevision: 'fixture' }),
      subscribe: vi.fn(() => unsubscribe),
      refreshInstalled: vi.fn(({ signal }: { signal: AbortSignal }) => {
        refreshSignal = signal;
        return pendingRefresh;
      }),
    } as unknown as PluginManagementRendererService;

    const dispose = activateDeclarativePluginUiGateway({ mount } as unknown as RendererPluginRuntime, service, { refresh: async () => undefined });
    expect(typeof dispose).toBe('function');
    expect(mount).not.toHaveBeenCalled();
    if (closeBeforeRefresh) {
      await dispose();
      expect(refreshSignal?.aborted).toBe(true);
    }

    // Even an upstream that ignores cancellation must never mount after gateway disposal.
    finishRefresh();
    await pendingRefresh;
    if (closeBeforeRefresh) {
      expect(mount).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
      await dispose();
      expect(disposeMount).toHaveBeenCalledOnce();
    }
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps settings in Plugin details and limits chat to compact primitives', () => {
    const settings = contribution({
      id: 'safe.settings',
      slot: 'renderer.capabilities.plugin.details',
      tree: { type: 'field', name: 'label', label: 'Label' },
    });
    expect(assertHostAllowedContribution(settings)).toBe(settings);

    const migratedLegacySettings = contribution({
      id: 'legacy.settings',
      slot: 'renderer.settings.page.extensions',
      target: 'general',
      tree: { type: 'text', text: 'Legacy settings' },
    });
    expect(migratedLegacySettings).toMatchObject({
      id: 'legacy.settings',
      slot: 'renderer.capabilities.plugin.details',
    });
    expect(migratedLegacySettings).not.toHaveProperty('target');
    expect(assertHostAllowedContribution(migratedLegacySettings)).toBe(migratedLegacySettings);
    expect(() => assertHostAllowedContribution(contribution({
      id: 'chat.field',
      slot: 'renderer.chat.composer.status',
      tree: { type: 'field', name: 'secret', label: 'Secret' },
    }))).toThrow('not allowed in the chat composer status');
    expect(rendererPluginIdentity('123_demo.plugin')).toMatch(/^p-(?:[a-f0-9]+-)*[a-f0-9]+$/u);
    expect(rendererPluginIdentity('demo_plugin')).not.toBe(rendererPluginIdentity('demo-plugin'));
  });

  it('stays subscribed and mounts a later snapshot after the initial refresh fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const disposeMount = vi.fn();
    const mountedPlugins: RendererPluginDefinition[] = [];
    const mount = vi.fn(async (plugin: RendererPluginDefinition) => {
      mountedPlugins.push(plugin);
      return disposeMount;
    });
    let plugins: readonly RuntimePluginSummary[] = [];
    let emitSnapshot: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: () => void) => {
      emitSnapshot = listener;
      return unsubscribe;
    });
    const refreshInstalled = vi.fn(async () => {
      throw new Error('transient startup failure');
    });
    const service = {
      getSnapshot: () => ({
        catalogRevision: 'fixture',
        extensions: [],
        marketplace: [],
        marketplaceErrors: [],
        plugins,
      }),
      refreshInstalled,
      subscribe,
    } as unknown as PluginManagementRendererService;

    const disposeGateway = activateDeclarativePluginUiGateway(
      { mount } as unknown as RendererPluginRuntime,
      service,
      { refresh: async () => undefined },
    );

    expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      refreshInstalled.mock.invocationCallOrder[0],
    );
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith(
      '[DeclarativePluginUi] Initial Plugin refresh failed; waiting for the next update.',
    ));
    expect(mount).not.toHaveBeenCalled();

    plugins = [installedUiPlugin()];
    emitSnapshot?.();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    const mountedPlugin = mountedPlugins[0];
    if (!mountedPlugin) throw new Error('Expected the declarative Renderer Plugin to mount.');
    const keyed = vi.fn(() => () => undefined);
    await mountedPlugin.activate({ ui: { keyed } as never });
    expect(keyed).toHaveBeenCalledWith(settingsPageSlot, expect.objectContaining({
      key: 'capabilities/recoverable-ui',
      metadata: expect.objectContaining({
        location: 'capabilities',
        sectionId: 'recoverable-ui',
      }),
    }));

    plugins = [];
    emitSnapshot?.();
    await vi.waitFor(() => expect(disposeMount).toHaveBeenCalledOnce());

    await disposeGateway();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(disposeMount).toHaveBeenCalledOnce();
  });

  it('maps standalone pages and uninstalls the owning plugin through the sidebar action', async () => {
    const list = vi.fn(() => vi.fn());
    const keyed = vi.fn(() => vi.fn());
    const disposeMount = vi.fn();
    const mount = vi.fn(async (plugin) => {
      await plugin.activate({
        ui: {
          chain: vi.fn(),
          keyed,
          list,
          owner: { pluginId: plugin.id, scopeId: `test:${plugin.id}` },
          single: vi.fn(),
        } as never,
      });
      return disposeMount;
    });
    const plugin = installedPagePlugin();
    let plugins = [plugin];
    let emitSnapshot: () => void = () => undefined;
    const refresh = vi.fn(async () => undefined);
    const remove = vi.fn(async ({ pluginId }: { pluginId: string }) => {
      plugins = [];
      emitSnapshot();
      return { pluginId, removedMcpServers: [], preservedMcpServers: [] };
    });
    const service = {
      getSnapshot: () => ({
        catalogRevision: 'fixture',
        extensions: [],
        marketplace: [],
        marketplaceErrors: [],
        plugins,
      }),
      refreshInstalled: vi.fn(async () => ({ plugins: [plugin] })),
      remove,
      subscribe: vi.fn((listener: () => void) => {
        emitSnapshot = listener;
        return () => undefined;
      }),
    } as unknown as PluginManagementRendererService;

    const dispose = activateDeclarativePluginUiGateway(
      { mount } as unknown as RendererPluginRuntime,
      service,
      { refresh },
    );

    await vi.waitFor(() => expect(list).toHaveBeenCalledWith(
      shellSidebarPluginEntrySlot,
      expect.objectContaining({ id: expect.stringContaining('.navigation') }),
    ));
    const sidebarCalls = list.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>;
    const sidebarRegistration = sidebarCalls.find(([slot]) => slot === shellSidebarPluginEntrySlot)?.[1];
    expect(sidebarRegistration).not.toHaveProperty('when');
    expect(keyed).toHaveBeenCalledWith(
      shellPluginPageSlot,
      expect.objectContaining({ id: expect.stringContaining('.page'), key: 'release-checker/release.page' }),
    );
    const renderSidebar = sidebarRegistration?.render as (props: {
      activeViewKey: null; onOpen(): void; onViewPlugin(pluginId: string): void;
    }) => ReactElement<{ onRemove(): Promise<void>; onViewPlugin(): void }>;
    const onViewPlugin = vi.fn();
    const entry = renderSidebar({ activeViewKey: null, onOpen: () => undefined, onViewPlugin });
    entry.props.onViewPlugin();
    expect(onViewPlugin).toHaveBeenCalledWith(plugin.id);
    await entry.props.onRemove();
    expect(remove).toHaveBeenCalledWith({ pluginId: plugin.id });
    expect(refresh).toHaveBeenCalledWith(['skills', 'mcp']);
    await vi.waitFor(() => expect(disposeMount).toHaveBeenCalledOnce());
    await dispose();
    expect(disposeMount).toHaveBeenCalledOnce();
  });

  it('remounts sandbox pages when the trusted catalog revision changes', async () => {
    const plugin = installedPagePlugin();
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const mount = vi.fn()
      .mockResolvedValueOnce(firstDispose)
      .mockResolvedValueOnce(secondDispose);
    let catalogRevision = 'revision-1';
    let emitSnapshot: (() => void) | undefined;
    const service = {
      getSnapshot: () => ({
        catalogRevision,
        extensions: [],
        marketplace: [],
        marketplaceErrors: [],
        plugins: [plugin],
      }),
      refreshInstalled: vi.fn(async () => ({ plugins: [plugin] })),
      subscribe: vi.fn((listener: () => void) => {
        emitSnapshot = listener;
        return () => undefined;
      }),
    } as unknown as PluginManagementRendererService;

    const dispose = activateDeclarativePluginUiGateway(
      { mount } as unknown as RendererPluginRuntime,
      service,
      { refresh: async () => undefined },
    );
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());

    catalogRevision = 'revision-2';
    emitSnapshot?.();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(firstDispose).toHaveBeenCalledOnce();

    await dispose();
    expect(secondDispose).toHaveBeenCalledOnce();
  });
});

function contribution(input: Record<string, unknown>) {
  return parseRuntimePluginUiManifest({
    schemaVersion: 1,
    actions: [],
    contributions: [input],
  }).contributions[0];
}

function installedUiPlugin(): RuntimePluginSummary {
  return {
    id: 'recoverable-ui',
    name: 'Recoverable UI',
    installedAt: '2026-08-30T00:00:00.000Z',
    skills: [],
    mcpServers: [],
    hooks: [],
    hookCount: 0,
    resources: [],
    extension: {
      apiVersion: 1,
      runtime: 'node-worker',
      capabilities: ['ui'],
      trust: 'trusted',
      rendererUi: parseRuntimePluginUiManifest({
        schemaVersion: 1,
        actions: [],
        contributions: [{
          id: 'recoverable.settings',
          slot: 'renderer.capabilities.plugin.details',
          tree: { type: 'text', text: 'Recovered' },
        }],
      }),
    },
  };
}

function installedPagePlugin(): RuntimePluginSummary {
  return {
    id: 'release-checker',
    name: 'Release checker',
    description: 'Checks a project before release.',
    installedAt: '2026-08-31T00:00:00.000Z',
    skills: [],
    mcpServers: [],
    hooks: [],
    hookCount: 0,
    resources: [],
    extension: {
      apiVersion: 1,
      runtime: 'node-worker',
      capabilities: ['ui', 'state'],
      trust: 'trusted',
      rendererUi: parseRuntimePluginUiManifest({
        schemaVersion: 2,
        actions: [],
        contributions: [{
          id: 'release.page',
          slot: 'renderer.plugin.page',
          navigation: { label: 'Release checker', badge: { path: 'summary.label' } },
          data: { stateKey: 'release.view', scope: 'project' },
          tree: { type: 'text', text: { path: 'summary.detail', fallback: 'Not run' } },
        }],
      }),
    },
  };
}
