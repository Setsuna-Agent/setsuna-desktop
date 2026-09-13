import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Mirrors the public openai/plugins GitHub bundle's MCP and optional App declarations.
export async function writeCodexPluginFixture(root: string, url = 'https://api.githubcopilot.com/mcp/'): Promise<string> {
  const bundleDir = path.join(root, 'codex-github');
  await mkdir(path.join(bundleDir, '.codex-plugin'), { recursive: true });
  await Promise.all([
    writeBundleJson(bundleDir, '.codex-plugin/plugin.json', {
      name: 'github', version: '0.1.11', description: 'Inspect repositories, pull requests and CI.',
      author: { name: 'OpenAI' }, keywords: ['github', 'git'],
      apps: './.app.json', interface: { displayName: 'GitHub', composerIcon: './assets/github-small.svg' },
    }),
    writeBundleJson(bundleDir, '.mcp.json', {
      mcpServers: { github: { type: 'http', url, bearer_token_env_var: 'GITHUB_PAT_TOKEN' } },
    }),
    writeBundleJson(bundleDir, '.app.json', {
      apps: {
        github: { id: 'connector_76869538009648d5b282a4bb21c3d157', required: false },
        'github-enterprise': { id: 'templated_apps_GitHubEnterprise', required: false },
      },
    }),
  ]);
  return bundleDir;
}

export async function writeBundleJson(root: string, relativePath: string, value: unknown): Promise<void> {
  await writeFile(path.join(root, relativePath), JSON.stringify(value, null, 2));
}
