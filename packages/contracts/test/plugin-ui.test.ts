import {
  parseRuntimePluginUiManifest,
  RUNTIME_PLUGIN_UI_LIMITS,
} from '../src/plugin-ui.js';
import { describe, expect, it } from 'vitest';

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
});

function deepStack(depth: number): unknown {
  let node: unknown = { type: 'text', text: 'leaf' };
  for (let index = 0; index < depth; index += 1) node = { type: 'stack', children: [node] };
  return node;
}
