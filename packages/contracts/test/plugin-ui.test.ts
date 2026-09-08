import {
  parseRuntimePluginUiManifest,
  parseRuntimePluginUiData,
  RUNTIME_PLUGIN_UI_LIMITS,
} from '../src/plugin-ui.js';
import { parseRuntimePluginUiCardDeclarations } from '../src/plugin-ui-card.js';
import { describe, expect, it } from 'vitest';

describe('Plugin UI card declarations', () => {
  it('bounds static previews while validating each runtime card owner', () => {
    const preview = { html: '<main>Weather</main>', data: { temperature: 28 } };
    const cards = parseRuntimePluginUiCardDeclarations([{
      id: 'weather.current',
      label: 'Current weather',
      description: 'Interactive weather summary.',
      toolName: 'get_weather',
      preview,
    }]);

    expect(cards).toEqual([{
      id: 'weather.current',
      label: 'Current weather',
      description: 'Interactive weather summary.',
      toolName: 'get_weather',
      preview: { ...preview, css: '', js: '' },
    }]);
    expect(Object.isFrozen(cards)).toBe(true);
    expect(() => parseRuntimePluginUiCardDeclarations([
      { id: 'weather.current', label: 'Weather', toolName: 'get_weather', preview },
      { id: 'weather.current', label: 'Forecast', toolName: 'get_forecast', preview },
    ])).toThrow('Duplicate Plugin extension UI card');
    expect(() => parseRuntimePluginUiCardDeclarations([{
      id: 'weather.current',
      label: 'Weather',
      toolName: 'get_weather',
      preview,
      html: '<script />',
    }])).toThrow('Unsupported property');
    expect(() => parseRuntimePluginUiCardDeclarations([{
      id: 'weather.empty',
      label: 'Weather',
      toolName: 'get_weather',
      preview: { html: '', css: '', js: '' },
    }])).toThrow('must contain HTML or JavaScript');
  });
});

describe('Plugin declarative Renderer UI contract', () => {
  it('accepts the bounded host schema and rejects executable, unknown, or over-budget shapes', () => {
    const manifest = parseRuntimePluginUiManifest({
      schemaVersion: 1,
      actions: [{ id: 'profile.save', approval: { message: 'Save this Plugin profile?' } }],
      contributions: [{
        id: 'profile.settings',
        slot: 'renderer.capabilities.plugin.details',
        stateKey: 'profile',
        tree: {
          type: 'stack',
          children: [
            { type: 'field', name: 'displayName', label: 'Display name', required: true },
            { type: 'button', actionId: 'profile.save', label: 'Save' },
          ],
        },
      }],
    });

    expect(manifest.contributions[0]).toMatchObject({
      id: 'profile.settings',
      stateKey: 'profile',
      slot: 'renderer.capabilities.plugin.details',
    });
    const migratedLegacySettings = parseRuntimePluginUiManifest({
      schemaVersion: 1,
      actions: [],
      contributions: [{
        id: 'legacy.settings',
        slot: 'renderer.settings.page.extensions',
        target: 'general',
        tree: { type: 'text', text: 'Legacy settings' },
      }],
    }).contributions[0];
    expect(migratedLegacySettings).toMatchObject({
      id: 'legacy.settings',
      slot: 'renderer.capabilities.plugin.details',
    });
    expect(migratedLegacySettings).not.toHaveProperty('target');
    expect(Object.isFrozen(manifest.contributions[0].tree)).toBe(true);
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'unsafe',
        slot: 'renderer.capabilities.plugin.details',
        tree: { type: 'text', text: 'unsafe', dangerouslySetInnerHTML: { __html: '<script />' } },
      }],
    })).toThrow('unsupported property');
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'new.target',
        slot: 'renderer.capabilities.plugin.details',
        target: 'general',
        tree: { type: 'text', text: 'Not global' },
      }],
    })).toThrow('cannot declare a settings target');
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'root.takeover',
        slot: 'renderer.app.ready',
        tree: { type: 'text', text: 'take over' },
      }],
    })).toThrow('Slot is not allowed');
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'too.deep',
        slot: 'renderer.chat.composer.status',
        tree: deepStack(RUNTIME_PLUGIN_UI_LIMITS.depth + 1),
      }],
    })).toThrow('too deep');
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'chat.state',
        slot: 'renderer.chat.composer.status',
        stateKey: 'profile',
        tree: { type: 'text', text: 'unsafe state binding' },
      }],
    })).toThrow('cannot bind state outside Plugin details');
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'empty.state',
        slot: 'renderer.capabilities.plugin.details',
        stateKey: 'profile',
        tree: { type: 'text', text: 'no fields' },
      }],
    })).toThrow('requires at least one field');
  });

  it('supports a scoped standalone release-checker page with state bindings', () => {
    const manifest = parseRuntimePluginUiManifest({
      schemaVersion: 2,
      actions: [{ id: 'release.run', approval: { message: 'Run the project release checks?' } }],
      contributions: [{
        id: 'release.page',
        slot: 'renderer.plugin.page',
        navigation: { label: 'Release checker', badge: { path: 'summary.label', fallback: 'Not run' } },
        data: { stateKey: 'release.view', scope: 'project' },
        tree: {
          type: 'stack',
          children: [
            { type: 'notice', title: 'Latest result', text: { path: 'summary.detail', fallback: 'Run checks to begin.' } },
            { type: 'field', name: 'command', label: 'Check command', defaultValue: { path: 'config.command' } },
            { type: 'button', actionId: 'release.run', label: 'Run checks' },
          ],
        },
      }],
    });
    const data = parseRuntimePluginUiData({
      config: { command: 'pnpm test' },
      summary: { detail: '12 checks passed', label: 'Ready' },
    });

    expect(manifest.contributions[0]).toMatchObject({
      data: { scope: 'project', stateKey: 'release.view' },
      navigation: { label: 'Release checker' },
      slot: 'renderer.plugin.page',
    });
    expect(data.summary).toEqual({ detail: '12 checks passed', label: 'Ready' });
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'release.unscoped',
        slot: 'renderer.plugin.page',
        navigation: { label: 'Release checker' },
        tree: { type: 'text', text: { path: 'summary.label' } },
      }],
    })).toThrow('without a data declaration');
    expect(() => parseRuntimePluginUiData({ invalid: Number.NaN })).toThrow('non-finite');
    expect(() => parseRuntimePluginUiData({ oversized: 'x'.repeat(RUNTIME_PLUGIN_UI_LIMITS.dataBytes + 1) }))
      .toThrow('data is too large');
  });

  it('rejects settings targets and Plugin details scopes the host cannot supply', () => {
    expect(() => parseRuntimePluginUiManifest({
      schemaVersion: 2,
      actions: [],
      contributions: [{
        id: 'settings.unknown',
        slot: 'renderer.settings.page.extensions',
        target: 'runtime',
        tree: { type: 'text', text: 'Unsupported target' },
      }],
    })).toThrow('requires a known settings target');

    for (const scope of ['project', 'thread'] as const) {
      expect(() => parseRuntimePluginUiManifest({
        schemaVersion: 2,
        actions: [],
        contributions: [{
          id: `details.${scope}`,
          slot: 'renderer.capabilities.plugin.details',
          data: { stateKey: 'details.view', scope },
          tree: { type: 'text', text: 'Unavailable scope' },
        }],
      })).toThrow('Plugin details data must use global scope');
    }
  });

  it('supports a sandboxed standalone document but never embeds one into chat or settings', () => {
    const manifest = parseRuntimePluginUiManifest({
      schemaVersion: 2,
      actions: [{ id: 'weather.refresh', approval: { message: 'Refresh weather?' } }],
      contributions: [{
        id: 'weather.page',
        slot: 'renderer.plugin.page',
        navigation: { label: 'Weather' },
        data: { stateKey: 'weather.view', scope: 'global' },
        document: {
          htmlResourceId: 'weather-html',
          cssResourceId: 'weather-css',
          jsResourceId: 'weather-js',
          actionIds: ['weather.refresh'],
        },
      }],
    });

    expect(manifest.contributions[0]).toMatchObject({
      document: {
        htmlResourceId: 'weather-html',
        actionIds: ['weather.refresh'],
      },
    });
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'weather.chat',
        slot: 'renderer.chat.composer.status',
        document: { htmlResourceId: 'weather-html', actionIds: [] },
      }],
    })).toThrow('standalone Plugin page');
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'weather.ambiguous',
        slot: 'renderer.plugin.page',
        navigation: { label: 'Weather' },
        tree: { type: 'text', text: 'Weather' },
        document: { htmlResourceId: 'weather-html', actionIds: [] },
      }],
    })).toThrow('exactly one of tree or document');
  });
});

function deepStack(depth: number): unknown {
  let node: unknown = { type: 'text', text: 'leaf' };
  for (let index = 0; index < depth; index += 1) node = { type: 'stack', children: [node] };
  return node;
}
