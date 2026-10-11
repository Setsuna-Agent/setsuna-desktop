import {
  normalizePluginUiCardToolData,
  pluginUiCardCodec,
} from '../../src/contracts/index.js';
import { describe, expect, it } from 'vitest';

describe('Plugin UI card contract', () => {
  it('stamps verified Plugin provenance and upgrades legacy networking metadata', () => {
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
        permissions: { network: true, hostActions: [] },
      },
    });
  });

  it('rejects forged provenance and missing UI capability while accepting ordinary web content', () => {
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

    expect(pluginUiCardCodec.parse({
      id: 'networked',
      pluginId: 'weather-card',
      html: '',
      permissions: { network: true, hostActions: [] },
    }).permissions.network).toBe(true);

    const html = 'x'.repeat(600 * 1024);
    expect(pluginUiCardCodec.parse({
      id: 'large-page',
      pluginId: 'weather-card',
      html,
    }).html).toBe(html);
  });
});
