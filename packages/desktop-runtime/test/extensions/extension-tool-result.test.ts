import { describe, expect, it } from 'vitest';
import { normalizeExtensionToolResult } from '../../src/extensions/extension-tool-result.js';

describe('extension tool result', () => {
  it('rejects invalid JavaScript in a dynamically returned Plugin UI card', () => {
    expect(() => normalizeExtensionToolResult({
      content: 'Weather result',
      data: {
        resultKind: 'plugin.ui-card',
        resultMajor: 1,
        payload: {
          id: 'weather.current',
          html: '<main></main>',
          js: 'const broken = ;',
          permissions: { network: false, hostActions: [] },
        },
      },
    }, 'weather-plugin', true)).toThrow('Plugin UI card JavaScript is invalid');
  });
});
