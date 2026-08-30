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
        slot: 'renderer.settings.page.extensions',
        target: 'general',
        tree: {
          type: 'stack',
          children: [
            { type: 'field', name: 'displayName', label: 'Display name', required: true },
            { type: 'button', actionId: 'profile.save', label: 'Save' },
          ],
        },
      }],
    });

    expect(manifest.contributions[0]).toMatchObject({ id: 'profile.settings', target: 'general' });
    expect(Object.isFrozen(manifest.contributions[0].tree)).toBe(true);
    expect(() => parseRuntimePluginUiManifest({
      ...manifest,
      contributions: [{
        id: 'unsafe',
        slot: 'renderer.settings.page.extensions',
        target: 'general',
        tree: { type: 'text', text: 'unsafe', dangerouslySetInnerHTML: { __html: '<script />' } },
      }],
    })).toThrow('unsupported property');
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
  });
});

function deepStack(depth: number): unknown {
  let node: unknown = { type: 'text', text: 'leaf' };
  for (let index = 0; index < depth; index += 1) node = { type: 'stack', children: [node] };
  return node;
}
