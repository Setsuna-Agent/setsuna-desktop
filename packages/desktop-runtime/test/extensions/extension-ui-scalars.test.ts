import { expect, it } from 'vitest';
import { parseRuntimePluginUiManifest } from '@setsuna-desktop/contracts';
import { validateRendererUiActionValues } from '../../src/extensions/extension-renderer-ui-policy.js';
import { projectRendererUiState } from '../../src/extensions/extension-renderer-ui.js';

function manifest(number: Record<string, unknown> = {}) {
  return parseRuntimePluginUiManifest({ schemaVersion: 2, actions: [{ id: 'save' }], contributions: [{ id: 'settings', slot: 'renderer.capabilities.plugin.details', tree: {
    type: 'stack', children: [
      { type: 'number', name: 'strength', label: 'Strength', min: 0.1, max: 1, step: 0.1, defaultValue: 0.3, required: true, ...number },
      { type: 'boolean', name: 'enabled', label: 'Enabled', defaultValue: false },
      { type: 'button', actionId: 'save', label: 'Save' },
    ],
  } }] });
}
it('validates scalar inputs at the runtime boundary and projects only valid stored values', () => {
  const { contributions } = manifest();
  expect(() => validateRendererUiActionValues({ strength: '0.3', enabled: 'false' }, contributions)).not.toThrow();
  for (const strength of ['', 'Infinity', 'NaN', '0x1', '0.35', '-1', '1.1']) expect(() => validateRendererUiActionValues({ strength, enabled: 'true' }, contributions)).toThrow();
  expect(() => validateRendererUiActionValues({ strength: '0.3', enabled: 'yes' }, contributions)).toThrow();
  expect(() => validateRendererUiActionValues({ enabled: 'true' }, contributions)).toThrow();
  expect(projectRendererUiState({ strength: 0.3, enabled: false, unknown: 'secret' }, contributions[0]!)).toEqual({ strength: '0.3', enabled: 'false' });
  expect(projectRendererUiState({ strength: 9, enabled: 'yes' }, contributions[0]!)).toEqual({});
});
it.each([{ min: 2 }, { step: 0 }, { step: -1 }, { max: Infinity }, { defaultValue: '0.3' }, { defaultValue: 0.35 }])('rejects invalid scalar declarations: %j', (input) => {
  expect(() => manifest(input)).toThrow();
});
