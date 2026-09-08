import {
  normalizePluginUiCardToolData,
  pluginUiCardCodec,
  PLUGIN_UI_CARD_LIMITS,
} from '../../src/contracts/index.js';
import { describe, expect, it } from 'vitest';

describe('Plugin UI card contract', () => {
  it('stamps verified Plugin provenance and preserves bounded HTML, CSS, JS, and data', () => {
    const result = normalizePluginUiCardToolData({
      resultKind: 'plugin.ui-card',
      resultMajor: 1,
      payload: {
        id: 'weather.hangzhou.today',
        title: '杭州天气',
        html: '<main id="weather"></main>',
        css: '#weather { color: var(--setsuna-color-text); }',
        js: 'window.setsunaUI.ready.then(({ data }) => console.log(data.temperature));',
        data: { temperature: 28, condition: '晴' },
        permissions: { network: false, hostActions: [] },
      },
    }, 'weather-card');

    expect(result).toMatchObject({
      resultKind: 'plugin.ui-card',
      resultMajor: 1,
      payload: {
        id: 'weather.hangzhou.today',
        pluginId: 'weather-card',
        data: { temperature: 28, condition: '晴' },
        permissions: { network: false, hostActions: [] },
      },
    });
  });

  it('rejects direct capabilities, forged provenance, and oversized source', () => {
    expect(() => normalizePluginUiCardToolData({
      resultKind: 'plugin.ui-card',
      resultMajor: 1,
      payload: {
        id: 'forged',
        pluginId: 'other-plugin',
        html: '',
        permissions: { network: false, hostActions: [] },
      },
    }, 'weather-card')).toThrow('another Plugin owner');

    expect(() => normalizePluginUiCardToolData({
      resultKind: 'plugin.ui-card',
      resultMajor: 1,
      payload: { id: 'missing-capability', html: '' },
    }, 'weather-card', false)).toThrow('require the ui capability');

    expect(() => pluginUiCardCodec.parse({
      id: 'networked',
      pluginId: 'weather-card',
      html: '',
      permissions: { network: true, hostActions: [] },
    })).toThrow('cannot access the network directly');

    expect(() => pluginUiCardCodec.parse({
      id: 'too-large',
      pluginId: 'weather-card',
      html: 'x'.repeat(PLUGIN_UI_CARD_LIMITS.htmlBytes + 1),
    })).toThrow('html is too large');
  });
});
