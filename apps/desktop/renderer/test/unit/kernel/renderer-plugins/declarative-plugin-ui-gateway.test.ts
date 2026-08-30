import {
  parseRuntimePluginUiManifest,
  type RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateDeclarativePluginUiGateway,
  assertHostAllowedContribution,
  rendererPluginIdentity,
} from '../../../../src/kernel/declarative-plugin-ui/gateway.js';
import type { RendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';

describe('declarative Plugin UI gateway', () => {
  afterEach(() => vi.restoreAllMocks());

  it('allows only approved settings targets and compact chat primitives', () => {
    const settings = contribution({
      id: 'safe.settings',
      slot: 'renderer.settings.page.extensions',
      target: 'general',
      tree: { type: 'field', name: 'label', label: 'Label' },
    });
    expect(assertHostAllowedContribution(settings)).toBe(settings);

    expect(() => assertHostAllowedContribution(contribution({
      ...settings,
      id: 'runtime.settings',
      target: 'runtime',
    }))).toThrow('not host-allowlisted');
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
    const mount = vi.fn(async () => disposeMount);
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

    const disposeGateway = await activateDeclarativePluginUiGateway(
      { mount } as unknown as RendererPluginRuntime,
      service,
    );

    expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      refreshInstalled.mock.invocationCallOrder[0],
    );
    expect(warning).toHaveBeenCalledWith(
      '[DeclarativePluginUi] Initial Plugin refresh failed; waiting for the next update.',
    );
    expect(mount).not.toHaveBeenCalled();

    plugins = [installedUiPlugin()];
    emitSnapshot?.();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());

    await disposeGateway();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(disposeMount).toHaveBeenCalledOnce();
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
          slot: 'renderer.settings.page.extensions',
          target: 'general',
          tree: { type: 'text', text: 'Recovered' },
        }],
      }),
    },
  };
}
