import { describe, expect, it } from 'vitest';
import { defaultProviderRequestHeaders } from '../../src/contracts/index.js';
import { createRequestHeaderRow, parseRequestHeaderRows, requestHeaderRows } from '../../src/renderer/request-header-editor.js';

describe('request header editing', () => {
  it('round-trips presets and preserves colons and template values', () => {
    const defaults = defaultProviderRequestHeaders('opencode-go');
    expect(parseRequestHeaderRows(requestHeaderRows(defaults))).toEqual(defaults);
    expect(parseRequestHeaderRows([
      createRequestHeaderRow('X-Route', 'https://proxy.test:8443'),
      createRequestHeaderRow('X-Session', '{{sessionId}}'),
      createRequestHeaderRow(),
    ])).toEqual({
      'x-route': 'https://proxy.test:8443', 'x-session': '{{sessionId}}',
    });
    expect(parseRequestHeaderRows(requestHeaderRows({}))).toEqual({});
    expect(parseRequestHeaderRows([createRequestHeaderRow(' X-Empty ', '')])).toEqual({ 'x-empty': '' });
  });

  it.each([
    [['', 'value']],
    [['Bad Name', 'value']],
    [['X-Test', 'one'], [' x-test ', 'two']],
    [['x-test', 'one'], ['x-test', 'two']],
    [['x-test', 'bad\u0000value']],
    [['x-test', 'value\r\n']],
    [['x-test', '非 HTTP 字节']],
  ])('rejects invalid or ambiguous header rows: %j', (...entries) => {
    expect(() => parseRequestHeaderRows(entries.map(([name, value]) => createRequestHeaderRow(name, value)))).toThrow();
  });
});
