import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfigurePluginSources } from '../../../src/adapters/tool/configure-plugin-sources.js';
import { MAX_CONFIGURE_PLUGIN_TEXT_BYTES } from '../../../src/adapters/tool/configure-plugin-tool.js';
import type { ToolExecutionContext } from '../../../src/ports/tool-host.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-sources-'));
  roots.push(root);
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const context: ToolExecutionContext = {
    threadId: 'thread_1', permissionProfile: 'workspace-write',
    environment: { id: 'workspace', cwd: workspace, workspaceRoot: workspace, workspaceRoots: [workspace] },
  };
  return { root, workspace, context };
}

const inputFor = (sourcePath: string) => ({
  manifest: { id: 'demo', name: 'Demo' }, files: [{ path: 'guide.md', sourcePath }],
});

describe('configure_plugin file sources', () => {
  it('enforces approved read roots and deny rules including symlink targets', async () => {
    const { root, workspace, context } = await fixture();
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'guide.md'), '# Guide');
    await symlink(outside, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const source of ['../outside/guide.md', 'linked/guide.md']) {
      await expect(resolveConfigurePluginSources(inputFor(source), context)).rejects.toThrow('readable_roots');
    }
    const allowed = { ...context, sandboxWorkspaceWrite: { readableRoots: [outside] } };
    await expect(resolveConfigurePluginSources(inputFor('linked/guide.md'), allowed)).resolves.toMatchObject({
      files: [{ path: 'guide.md', content: '# Guide' }],
    });
    await expect(resolveConfigurePluginSources(inputFor('linked/guide.md'), {
      ...allowed, sandboxWorkspaceWrite: { readableRoots: [outside], deniedRoots: [outside] },
    })).rejects.toThrow('deny');
  });

  it('rejects non-text files and bounds the total source plus inline payload', async () => {
    const { workspace, context } = await fixture();
    await writeFile(path.join(workspace, 'invalid.bin'), Buffer.from([0xff, 0xfe]));
    await expect(resolveConfigurePluginSources(inputFor('invalid.bin'), context)).rejects.toThrow('UTF-8');
    await expect(resolveConfigurePluginSources(inputFor('.'), context)).rejects.toThrow('regular file');
    await writeFile(path.join(workspace, 'large.txt'), Buffer.alloc(MAX_CONFIGURE_PLUGIN_TEXT_BYTES, 97));
    await expect(resolveConfigurePluginSources(inputFor('large.txt'), context)).rejects.toThrow('exceeds');
    await writeFile(path.join(workspace, 'small.txt'), 'small');
    await expect(resolveConfigurePluginSources({
      ...inputFor('small.txt'), files: [
        { path: 'first.txt', content: 'a'.repeat(MAX_CONFIGURE_PLUGIN_TEXT_BYTES - Buffer.byteLength(JSON.stringify(inputFor('small.txt').manifest)) - 4) },
        { path: 'second.txt', sourcePath: 'small.txt' },
      ],
    }, context)).rejects.toThrow('exceeds');
  });

  it('provides a file-reference recovery path for malformed or ambiguous content', async () => {
    for (const file of [
      { path: 'page.html', content: { main: { $text: 'Hello' } } },
      { $text: 'Hello' }, '<main>fragment</main>',
      { path: 'page.html', sourcePath: 'page.html', content: '<main>Hello</main>' },
    ]) {
      await expect(resolveConfigurePluginSources({ manifest: {}, files: [file] })).rejects.toThrow('Prefer sourcePath');
    }
    await expect(resolveConfigurePluginSources(inputFor('page.html'))).rejects.toThrow('current workspace');
  });
});
