import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { FilePluginBundleStore } from '../../../../src/adapters/plugin/file-plugin-bundle-store.js';
import { FileSkillRegistry } from '../../../../src/adapters/skill/file-skill-registry.js';
import { FileConfigStore } from '../../../../src/adapters/store/file-config-store.js';
import { FileMcpStore } from '../../../../src/adapters/store/file-mcp-store.js';
import { FileExtensionStateStore } from '../../../../src/extensions/file-extension-state-store.js';
import { systemClock } from '../../../../src/ports/clock.js';
import { InMemoryDesktopNativeBridge } from '../../../support/in-memory-secret-store.js';

export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export async function createPluginRuntime(root: string) {
  const dataDir = path.join(root, 'runtime');
  const builtinDir = path.join(root, 'builtin-skills');
  await mkdir(builtinDir, { recursive: true });
  const skills = new FileSkillRegistry(builtinDir, dataDir);
  const mcp = new FileMcpStore(dataDir, new InMemoryDesktopNativeBridge());
  const config = new FileConfigStore(dataDir);
  const extensionState = new FileExtensionStateStore(dataDir);
  const invalidateServer = vi.fn(async () => undefined);
  const plugins = new FilePluginBundleStore(
    dataDir,
    skills,
    mcp,
    { invalidateServer },
    config,
    systemClock,
    extensionState,
  );
  return { config, dataDir, extensionState, invalidateServer, mcp, plugins, skills };
}

export async function readPluginManifestFixture(bundleDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), 'utf8'),
  ) as Record<string, unknown>;
}

export async function writePluginManifestFixture(
  bundleDir: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    path.join(bundleDir, '.setsuna-plugin', 'plugin.json'),
    JSON.stringify(manifest, null, 2),
  );
}

export async function patchPluginManifest(
  bundleDir: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await writePluginManifestFixture(bundleDir, {
    ...await readPluginManifestFixture(bundleDir),
    ...patch,
  });
}

export async function addExecutableExtension(bundleDir: string): Promise<void> {
  await mkdir(path.join(bundleDir, 'extension'), { recursive: true });
  await writeFile(path.join(bundleDir, 'extension', 'entry.mjs'), 'export default () => {};\n');
  await patchPluginManifest(bundleDir, {
    schemaVersion: 2,
    extension: {
      apiVersion: 1,
      runtime: 'node-worker',
      entry: 'extension/entry.mjs',
      capabilities: ['tools', 'events', 'state', 'ui'],
    },
  });
}

export async function addSandboxedRendererPage(bundleDir: string): Promise<{
  rendererUi: Record<string, unknown>;
  resources: Array<Record<string, unknown>>;
}> {
  await mkdir(path.join(bundleDir, 'ui'), { recursive: true });
  await Promise.all([
    writeFile(path.join(bundleDir, 'ui', 'page.html'), '<main id="app"></main>\n'),
    writeFile(path.join(bundleDir, 'ui', 'page.css'), '#app { display: grid; }\n'),
    writeFile(path.join(bundleDir, 'ui', 'page.js'), 'window.setsunaUI.ready.then(() => {});\n'),
  ]);
  const manifest = await readPluginManifestFixture(bundleDir);
  const extension = manifest.extension as Record<string, unknown>;
  const resources = [
    ...(manifest.resources as Array<Record<string, unknown>>),
    { id: 'page-html', path: 'ui/page.html' },
    { id: 'page-css', path: 'ui/page.css' },
    { id: 'page-js', path: 'ui/page.js' },
  ];
  const rendererUi = {
    schemaVersion: 2,
    actions: [],
    contributions: [{
      id: 'plugin.page',
      slot: 'renderer.plugin.page',
      navigation: { label: 'Plugin page' },
      document: {
        htmlResourceId: 'page-html',
        cssResourceId: 'page-css',
        jsResourceId: 'page-js',
        actionIds: [],
      },
    }],
  };
  await patchPluginManifest(bundleDir, {
    resources,
    extension: { ...extension, rendererUi },
  });
  return { rendererUi, resources };
}

export async function createPluginFixture(
  parent?: string,
): Promise<{ root: string; bundleDir: string }> {
  const root = parent ?? await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-test-'));
  await mkdir(root, { recursive: true });
  const bundleDir = path.join(root, 'bundle');
  await Promise.all([
    mkdir(path.join(bundleDir, '.setsuna-plugin'), { recursive: true }),
    mkdir(path.join(bundleDir, 'skills', 'docs-helper'), { recursive: true }),
    mkdir(path.join(bundleDir, 'hooks'), { recursive: true }),
    mkdir(path.join(bundleDir, 'resources'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(bundleDir, 'skills', 'docs-helper', 'SKILL.md'), [
      '---',
      'name: Plugin Docs Helper',
      'description: Reads bundled documentation.',
      '---',
      '',
      '# Plugin Docs Helper',
      '',
      'Use the bundled docs.',
    ].join('\r\n')),
    writeFile(path.join(bundleDir, 'hooks', 'post.mjs'), 'process.exit(0);\n'),
    writeFile(path.join(bundleDir, 'resources', 'guide.md'), '# Bundled guide\n'),
    writeFile(path.join(bundleDir, 'resources', 'logo.png'), ONE_PIXEL_PNG),
    writeFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'demo',
      name: 'Demo Plugin',
      icon: 'context7',
      version: '1.0.0',
      description: 'Plugin fixture',
      tools: [{
        name: 'analyze_document',
        description: 'Analyze the current document.',
      }],
      skills: ['skills/docs-helper'],
      mcpServers: [{
        key: 'plugin_docs',
        label: 'Plugin Docs',
        description: 'Search bundled documentation.',
        transport: 'streamable_http',
        url: 'https://docs.example/mcp',
      }],
      hooks: [{
        id: 'audit-read',
        name: 'Audit reads',
        description: 'Records documentation reads.',
        eventName: 'PostToolUse',
        matcher: 'read_file',
        command: 'node {{pluginRoot}}/hooks/post.mjs',
        timeoutSec: 10,
      }],
      resources: [
        { id: 'guide', label: 'Guide', path: 'resources/guide.md' },
        { id: 'logo', label: 'Logo', path: 'resources/logo.png' },
      ],
    }, null, 2)),
  ]);
  return { root, bundleDir };
}
