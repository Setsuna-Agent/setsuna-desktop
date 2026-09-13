import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { create } from 'tar';
import { vi } from 'vitest';
import { createTestTempDirectory } from '../../../support/test-temp-directory.js';
import { writeBundleJson, writeCodexPluginFixture } from './codex-plugin-fixture.js';

export async function createRepositorySourceFixture() {
  const root = await createTestTempDirectory('setsuna-repository-marketplace-');
  const repository = path.join(root, 'repository');
  const source = await writeCodexPluginFixture(path.join(repository, 'plugins'));
  await mkdir(path.join(source, 'assets'), { recursive: true });
  await writeFile(path.join(source, 'assets/github-small.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>');
  await mkdir(path.join(source, 'skills/review'), { recursive: true });
  await writeFile(path.join(source, 'skills/review/SKILL.md'), '---\nname: review\ndescription: Review\n---\nReview version one.\n');
  const unsupported = path.join(repository, 'plugins/required-app');
  await mkdir(path.join(unsupported, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(repository, 'plugins/unlisted/.codex-plugin'), { recursive: true });
  await mkdir(path.join(repository, '.agents/plugins'), { recursive: true });
  await writeBundleJson(unsupported, '.codex-plugin/plugin.json', { name: 'required-app', version: '1.0.0' });
  await writeBundleJson(unsupported, '.app.json', { apps: { app: { id: 'app', required: true } } });
  const approvalRequired = path.join(repository, 'plugins/figma');
  await mkdir(path.join(approvalRequired, '.codex-plugin'), { recursive: true });
  await writeBundleJson(approvalRequired, '.codex-plugin/plugin.json', { name: 'figma', version: '1.0.0' });
  await writeBundleJson(approvalRequired, '.mcp.json', {
    mcpServers: { figma: { type: 'http', url: 'https://mcp.figma.com/mcp' } },
  });
  await writeBundleJson(repository, 'plugins/unlisted/.codex-plugin/plugin.json', { name: 'unlisted' });
  await writeBundleJson(repository, '.agents/plugins/marketplace.json', {
    name: 'openai-curated',
    plugins: [
      { name: 'github', source: { source: 'local', path: './plugins/codex-github' }, category: 'Developer Tools', policy: { installation: 'AVAILABLE' } },
      { name: 'figma', source: { source: 'local', path: './plugins/figma' } },
      { name: 'required-app', source: { source: 'local', path: './plugins/required-app' } },
      { name: 'external', source: { source: 'git-subdir', url: 'https://example.com/external' } },
    ],
  });
  let revision = 'a'.repeat(40);
  let bytes: Uint8Array<ArrayBuffer>;
  const publish = async (nextRevision: string) => {
    revision = nextRevision;
    const archive = path.join(root, 'repository.tar.gz');
    await create({ file: archive, cwd: root, gzip: true }, ['repository']);
    bytes = new Uint8Array(await readFile(archive));
  };
  await publish(revision);
  const fetch = vi.fn(async (url: string | URL) => String(url).includes('api.github.com')
    ? Response.json({ object: { sha: revision } }) : new Response(bytes));
  return { root, source, fetch, publish };
}
