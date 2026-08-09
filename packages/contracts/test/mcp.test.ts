import { describe, expect, it } from 'vitest';
import { mergeRuntimeMcpServerInput } from '../src/mcp.js';

describe('mergeRuntimeMcpServerInput', () => {
  it('preserves omitted secret-bearing fields while accepting explicit replacements', () => {
    const merged = mergeRuntimeMcpServerInput({
      key: 'docs',
      label: 'Old label',
      env: { API_KEY: 'secret' },
      headers: { Authorization: 'Bearer secret' },
      envHttpHeaders: { Authorization: 'AUTH_TOKEN' },
      bearerTokenEnvVar: 'MCP_TOKEN',
    }, {
      key: 'docs',
      label: 'New label',
      headers: {},
    });

    expect(merged).toEqual({
      key: 'docs',
      label: 'New label',
      env: { API_KEY: 'secret' },
      headers: {},
      envHttpHeaders: { Authorization: 'AUTH_TOKEN' },
      bearerTokenEnvVar: 'MCP_TOKEN',
    });
  });
});
