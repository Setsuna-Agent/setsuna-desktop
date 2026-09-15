import { describe, expect, it } from 'vitest';
import { defaultProviderRequestHeaders } from '../../src/contracts/index.js';
import { formatRequestHeaders, parseRequestHeaders } from '../../src/renderer/request-header-editor.js';

describe('request header editing', () => {
  it('round-trips presets and preserves colons and template values', () => {
    const defaults = defaultProviderRequestHeaders('opencode-go');
    expect(parseRequestHeaders(formatRequestHeaders(defaults))).toEqual(defaults);
    expect(parseRequestHeaders('X-Route: https://proxy.test:8443\nX-Session: {{sessionId}}\n')).toEqual({
      'x-route': 'https://proxy.test:8443', 'x-session': '{{sessionId}}',
    });
    expect(parseRequestHeaders('')).toEqual({});
  });

  it.each([
    'Missing separator', 'Bad Name: value', 'X-Test: one\nx-test: two',
    'x-test: one\nx-test: two', 'x-test: bad\u0000value', 'x-test: 非 HTTP 字节',
  ])('rejects invalid or ambiguous header edits: %s', (text) => {
    expect(() => parseRequestHeaders(text)).toThrow();
  });
});
