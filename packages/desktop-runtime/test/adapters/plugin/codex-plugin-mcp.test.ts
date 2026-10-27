import { describe, expect, it } from 'vitest';
import { convertCodexMcpServers } from '../../../src/adapters/plugin/codex-plugin-mcp.js';

const bundledOAuth = {
  client_id: 'upstream-client', client_secret: 'fixture-secret',
  callback_port: 12799, callback_url: 'http://127.0.0.1:12799/callback/upstream',
};

describe('Codex MCP OAuth compatibility', () => {
  it('removes imported client aliases while preserving explicit PAT references and tool restrictions', () => {
    const [server] = convertCodexMcpServers({ github: {
      type: 'http', url: 'https://api.githubcopilot.com/mcp/', oauth: bundledOAuth,
      oauthClientId: 'camel-client', oauth_client_id: 'snake-client',
      oauthResource: 'https://example.com/camel', oauth_resource: 'https://example.com/snake',
      bearer_token_env_var: 'USER_GITHUB_TOKEN', allowed_tools: ['list_issues'],
    } });
    expect(server).toMatchObject({
      key: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/',
      bearer_token_env_var: 'USER_GITHUB_TOKEN', allowed_tools: ['list_issues'],
    });
    for (const field of ['oauth', 'oauthClientId', 'oauth_client_id', 'oauthResource', 'oauth_resource']) {
      expect(server).not.toHaveProperty(field);
    }
    expect(JSON.stringify(server)).not.toContain('fixture-secret');
  });

  it('retains a supported public OAuth client when no host-specific registration is required', () => {
    expect(convertCodexMcpServers({ github: {
      type: 'http', url: 'https://api.githubcopilot.com/mcp/',
      oauth: { client_id: 'user-public-client', resource: 'https://api.githubcopilot.com' },
    } })).toEqual([expect.objectContaining({
      oauthClientId: 'user-public-client', oauthResource: 'https://api.githubcopilot.com',
    })]);
  });

  it.each([
    ['http://api.githubcopilot.com/mcp/', 'http'],
    ['https://api.githubcopilot.com.attacker.example/mcp/', 'http'],
    ['https://api.githubcopilot.com:8443/mcp/', 'http'],
    ['https://user:password@api.githubcopilot.com/mcp/', 'http'],
    ['https://api.githubcopilot.com/not-mcp', 'http'],
    ['https://api.githubcopilot.com/mcp/#fragment', 'http'],
    ['https://example.com/mcp/', 'http'],
    ['https://api.githubcopilot.com/mcp/', 'stdio'],
  ])('rejects bundled credentials outside the host OAuth boundary: %s (%s)', (url, type) => {
    expect(() => convertCodexMcpServers({ github: { type, url, oauth: bundledOAuth } }))
      .toThrow('unsupported OAuth options: client_secret, callback_port, callback_url');
  });

  it('still rejects unknown OAuth requirements on the official GitHub endpoint', () => {
    expect(() => convertCodexMcpServers({ github: {
      type: 'http', url: 'https://api.githubcopilot.com/mcp/', oauth: { ...bundledOAuth, scopes: ['custom-scope'] },
    } })).toThrow('unsupported OAuth options: scopes');
  });
});
