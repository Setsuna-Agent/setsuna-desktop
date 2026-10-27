import type { RuntimeMcpServerInput } from '@setsuna-desktop/contracts';
import { isGitHubMcpEndpoint } from '../../../contracts/oauth-endpoints.js';

export type McpDeviceOAuthProvider = {
  clientId: string;
  deviceUrl: string;
  tokenUrl: string;
  verificationUrl: string;
  scopes: string[];
};

// Public application identifier. Provider endpoints are host-owned, never supplied by a plugin.
const GITHUB_CLIENT_ID = 'Ov23liO3gnwsphaS5oLy';
const GITHUB: McpDeviceOAuthProvider = {
  clientId: GITHUB_CLIENT_ID,
  deviceUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  verificationUrl: 'https://github.com/login/device',
  scopes: ['repo', 'read:org'],
};

export function mcpDeviceOAuthProvider(server: RuntimeMcpServerInput): McpDeviceOAuthProvider | undefined {
  if (server.transport === 'stdio' || !server.url) return undefined;
  // Explicit third-party client registrations retain the existing OAuth flow.
  if (server.oauthClientId && server.oauthClientId !== GITHUB_CLIENT_ID) return undefined;
  return isGitHubMcpEndpoint(server.url) ? GITHUB : undefined;
}
