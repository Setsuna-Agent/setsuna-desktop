import type { RuntimePluginConnector } from '@setsuna-desktop/contracts';

// Compatibility data only: the UI and status reader use the same declarations as native plugins.
// These are alternative access methods, not implementations of OpenAI's hosted App tool protocol.
const APP_CONNECTORS: Readonly<Record<string, RuntimePluginConnector>> = {
  connector_76869538009648d5b282a4bb21c3d157: {
    id: 'github-cli', name: 'GitHub CLI', required: false, kind: 'cli', command: 'gh',
    installUrl: 'https://cli.github.com/', documentationUrl: 'https://cli.github.com/manual/gh_auth_login',
    setupCommands: ['gh auth login --hostname github.com --web', 'gh auth status --hostname github.com'],
  },
  templated_apps_GitHubEnterprise: {
    id: 'github-enterprise-cli', name: 'GitHub Enterprise CLI', required: false, kind: 'cli', command: 'gh',
    installUrl: 'https://cli.github.com/', documentationUrl: 'https://cli.github.com/manual/gh_auth_login',
    // Interactive login asks for the enterprise hostname; no private host is baked into the package.
    setupCommands: ['gh auth login', 'gh auth status'],
  },
};

export function codexAppConnector(appId: string): RuntimePluginConnector | undefined {
  const connector = APP_CONNECTORS[appId];
  return connector ? structuredClone(connector) : undefined;
}
