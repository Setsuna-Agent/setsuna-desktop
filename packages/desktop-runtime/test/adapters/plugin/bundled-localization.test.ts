import { pluginMentionText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FilePluginBundleStore } from '../../../src/adapters/plugin/file-plugin-bundle-store.js';
import { FilePluginDraftStore } from '../../../src/adapters/plugin/file-plugin-draft-store.js';
import { FilePluginMarketplace } from '../../../src/adapters/plugin/file-plugin-marketplace.js';
import { installDefaultPlugins } from '../../../src/adapters/plugin/install-default-plugins.js';
import { inspectBundleTree } from '../../../src/adapters/plugin/file-plugin-bundle-model.js';
import { localizePluginDisplayFields, readBundledPluginMessages } from '../../../src/adapters/plugin/bundled-plugin-localization.js';
import { FileSkillRegistry } from '../../../src/adapters/skill/file-skill-registry.js';
import { PluginBundleToolHost } from '../../../src/adapters/tool/plugin-bundle-tool-host.js';
import { FileConfigStore } from '../../../src/adapters/store/file-config-store.js';
import { FileMcpStore } from '../../../src/adapters/store/file-mcp-store.js';
import { FileExtensionStateStore } from '../../../src/extensions/file-extension-state-store.js';
import { ExtensionManager } from '../../../src/extensions/extension-manager.js';
import { systemClock } from '../../../src/ports/clock.js';
import { InMemoryDesktopNativeBridge } from '../../support/in-memory-secret-store.js';
import { runtimePluginSelectionContext } from '../../../src/loop/context/runtime-plugin-selection-context.js';

const roots: string[] = [];
const catalogRoot = path.resolve('plugins');
const han = /\p{Script=Han}/u;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundled content localization', () => {
  it('keeps the built-in builder installed, rejects removal, and preserves localized Skill overrides', async () => {
    const { root, marketplace, plugins, skills, language } = await fixture();
    await Promise.all([installDefaultPlugins(root, marketplace), installDefaultPlugins(root, marketplace)]);
    const installed = (await plugins.listPlugins()).plugins;
    expect(installed).toEqual([
      expect.objectContaining({ id: 'app-builder', installationSource: 'marketplace' }),
      expect.objectContaining({ id: 'plugin-builder', installationSource: 'marketplace' }),
    ]);
    for (const builder of installed) {
      const selected = await runtimePluginSelectionContext(pluginMentionText(builder), plugins, 'zh-CN', []);
      expect(selected.skillIds).toEqual([`${builder.id}.create-plugin-in-chat`]);
    }
    expect(installed[0].tools?.map((tool) => tool.name)).toEqual(['read_runtime_api', 'configure_plugin', 'verify_plugin']);
    expect(installed[0].resources.map((resource) => resource.id)).toEqual([
      'ui-design', 'ui-base', 'ui-patterns', 'ui-component-guide', 'ui-components', 'ui-icons', 'react-app-guide', 'openui-guide',
    ]);
    for (const resource of installed[0].resources) {
      expect(await plugins.readResource('app-builder', resource.id)).toMatchObject({
        text: await readFile(path.join(catalogRoot, 'app-builder', resource.path), 'utf8'),
      });
    }
    const skillId = 'app-builder.create-plugin-in-chat';
    expect(await skills.getSkill(skillId)).toMatchObject({ kind: 'plugin', enabled: true });
    expect((await skills.resolvePromptContext([skillId])).selectedInjections[0].content).toContain('创建侧栏应用无需先选择项目');
    await language('en-US');
    const english = await skills.getSkill(skillId);
    expect(english?.content).toContain('Creating a sidebar app does not require a project.');
    expect(english?.name).not.toMatch(han);
    expect(await skills.getSkill('plugin-builder.create-plugin-in-chat')).toMatchObject({
      name: 'Create Plugin in Chat', content: expect.stringContaining('This Skill belongs to Plugin Builder.'),
    });
    expect(await plugins.readResource('plugin-builder', 'plugin-settings-guide')).toMatchObject({
      text: await readFile(path.join(catalogRoot, 'plugin-builder/skills/create-plugin-in-chat/references/plugin-settings.en-US.md'), 'utf8'),
    });
    expect(await plugins.readResource('app-builder', 'ui-design')).toMatchObject({
      text: await readFile(path.join(catalogRoot, 'app-builder/skills/create-plugin-in-chat/references/ui-design.en-US.md'), 'utf8'),
    });
    expect(await plugins.readResource('app-builder', 'openui-guide')).toMatchObject({
      text: await readFile(path.join(catalogRoot, 'app-builder/skills/create-plugin-in-chat/references/openui.en-US.md'), 'utf8'),
    });
    await skills.updateSkill(skillId, { content: '# My builder', enabled: false });
    await installDefaultPlugins(root, marketplace);
    expect(await skills.getSkill(skillId)).toMatchObject({ content: '# My builder', enabled: false });
    const indexBefore = await readFile(path.join(root, 'plugins.json'), 'utf8');
    for (const id of ['app-builder', 'plugin-builder']) {
      await expect(plugins.removePlugin(id)).rejects.toThrow('Built-in plugin cannot be uninstalled');
    }
    expect(await readFile(path.join(root, 'plugins.json'), 'utf8')).toBe(indexBefore);
    expect(await skills.getSkill(skillId)).toMatchObject({ content: '# My builder', enabled: false });
  });

  it('automatically upgrades the built-in builder without replacing Skill overrides', async () => {
    const { root, marketplace, plugins, skills } = await fixture();
    await installDefaultPlugins(root, marketplace);
    const skillId = 'app-builder.create-plugin-in-chat';
    await skills.updateSkill(skillId, { content: '# My builder', enabled: false });
    // Model an older installed version while retaining the real bundle and update transaction.
    const indexPath = path.join(root, 'plugins.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    const builder = index.plugins.find((plugin: { id: string }) => plugin.id === 'app-builder');
    builder.version = '1.4.4';
    builder.resources = [];
    await writeFile(indexPath, JSON.stringify(index));
    const stylesheet = 'skills/create-plugin-in-chat/assets/ui-base.css';
    await rm(path.join(builder.installPath, stylesheet));
    const skillPath = 'skills/create-plugin-in-chat/SKILL.md';
    await writeFile(path.join(builder.installPath, skillPath), '# Older builder: use an iframe.');
    await installDefaultPlugins(root, marketplace);
    expect((await plugins.listPlugins()).plugins[0]).toMatchObject({ version: '1.6.0' });
    expect(await plugins.readResource('app-builder', 'ui-base')).toMatchObject({
      text: await readFile(path.join(catalogRoot, 'app-builder', stylesheet), 'utf8'),
    });
    expect(await readFile(path.join(builder.installPath, skillPath), 'utf8'))
      .toBe(await readFile(path.join(catalogRoot, 'app-builder', skillPath), 'utf8'));
    expect(await skills.getSkill(skillId)).toMatchObject({ content: '# My builder', enabled: false });
  });

  it('restores a missing builder despite a legacy installation marker', async () => {
    const { root, marketplace, plugins } = await fixture();
    await writeFile(path.join(root, 'default-plugins.json'), JSON.stringify({ installedIds: ['app-builder'] }));
    await installDefaultPlugins(root, marketplace);
    expect((await plugins.listPlugins()).plugins).toEqual([
      expect.objectContaining({ id: 'app-builder', installationSource: 'marketplace', version: '1.6.0' }),
      expect.objectContaining({ id: 'plugin-builder', installationSource: 'marketplace', version: '1.0.0' }),
    ]);
  });

  it.each(['SKILL.md', 'SKILL.en-US.md'])('installs the native website example from %s through configure_plugin without page resources', async (filename) => {
    const { root, marketplace, plugins } = await fixture();
    await installDefaultPlugins(root, marketplace);
    const skill = await readFile(path.join(catalogRoot, 'app-builder/skills/create-plugin-in-chat', filename), 'utf8');
    const example = [...skill.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/gu)]
      .find((match) => match[1].includes('"manifest"') && match[1].includes('"webpage"'));
    expect(example).toBeDefined();
    const input: unknown = JSON.parse(example![1]);
    const host = new PluginBundleToolHost(plugins, new FilePluginDraftStore(path.join(root, 'drafts')));
    const context = { threadId: 'thread_1' };
    expect(await host.approvalForTool('configure_plugin', input, context)).not.toBeNull();
    const preview = await host.previewToolCall('configure_plugin', input, context);
    const result = await host.runTool('configure_plugin', input, {
      ...context, expectedPreviewIntegrityToken: preview?.integrityToken,
    });
    expect(result).toMatchObject({ data: {
      action: 'create',
      plugin: {
        id: 'baidu', resources: [],
        extension: { trust: 'trusted', capabilities: ['ui'], rendererUi: {
          actions: [], contributions: [{ id: 'baidu.page', slot: 'renderer.plugin.page', webpage: { url: 'https://www.baidu.com/' } }],
        } },
      },
      verification: { required: false },
    } });
  });

  it('allows removing a local bundle that reuses the builder ID', async () => {
    const { plugins } = await fixture();
    await plugins.installPlugin({ path: path.join(catalogRoot, 'app-builder') });
    await expect(plugins.removePlugin('app-builder')).resolves.toMatchObject({ pluginId: 'app-builder' });
    expect((await plugins.listPlugins()).plugins).toEqual([]);
  });

  it('switches every built-in Skill catalog, detail, and prompt without changing IDs or enabled state', async () => {
    const { skills, language } = await fixture();
    const chinese = await skills.listSkills();
    const ids = chinese.skills.map((skill) => skill.id).sort();
    expect(ids).toEqual(['create-mcp-in-chat', 'create-skill-in-chat', 'display-in-chat', 'goal-writer']);
    for (const skill of chinese.skills) {
      expect(skill.name).toMatch(han);
      expect(skill.description).toMatch(han);
    }
    await skills.updateSkill('goal-writer', { enabled: false });
    const user = await skills.createSkill({ id: 'user', name: '用户原文', content: '# 用户内容' });
    await language('en-US');
    const english = (await skills.listSkills()).skills.filter((skill) => skill.kind === 'builtin');
    expect(english.map((skill) => skill.id).sort()).toEqual(ids);
    expect(english.find((skill) => skill.id === 'goal-writer')?.enabled).toBe(false);
    for (const skill of english) {
      expect(skill.name).not.toMatch(han);
      expect(skill.description).not.toMatch(han);
      const detail = await skills.getSkill(skill.id);
      expect(detail?.content).not.toMatch(han);
      expect(await readFile(detail!.path!, 'utf8')).toContain(detail!.content);
    }
    const prompt = await skills.resolvePromptContext(['create-mcp-in-chat']);
    expect(prompt.selectedInjections[0]?.content).toContain('# Create MCP in Chat');
    const zhStep = await skills.resolvePromptContext(['create-mcp-in-chat'], { text: '', interfaceLanguage: 'zh-CN' });
    expect(zhStep.selectedInjections[0]?.content).toContain('# 对话创建 MCP');
    expect(zhStep.selectedInjections[0]?.contentVersion).not.toBe(prompt.selectedInjections[0]?.contentVersion);
    await language('zh-CN');
    expect((await skills.getSkill('goal-writer'))?.enabled).toBe(false);
    expect(await skills.getSkill('user')).toEqual(user);
  });

  it('localizes all marketplace metadata and installed content while preserving bundle trust and user overrides', async () => {
    const { marketplace, plugins, skills, language, root } = await fixture();
    await language('en-US');
    const english = await marketplace.listPlugins();
    expect(english.errors).toEqual([]);
    expect(english.plugins.length).toBeGreaterThan(0);
    for (const plugin of english.plugins) {
      expect(JSON.stringify(plugin), plugin.id).not.toMatch(han);
    }
    await marketplace.installPlugin('documents');
    await marketplace.installPlugin('todo');
    await marketplace.installPlugin('context7-docs');
    const records = await plugins.listInstalledRecords();
    const before = await readFile(path.join(root, 'plugins.json'), 'utf8');
    const revision = await plugins.catalogRevision();
    const englishSkill = await skills.getSkill('documents.documents');
    expect(englishSkill?.name).toBe('Word Documents');
    expect(englishSkill?.content).toContain('# Word Documents');
    await language('zh-CN');
    expect(await plugins.catalogRevision()).not.toBe(revision);
    const chinese = await marketplace.listPlugins();
    expect(chinese.errors).toEqual([]);
    expect(chinese.plugins.map((plugin) => plugin.id).sort()).toEqual(english.plugins.map((plugin) => plugin.id).sort());
    for (const plugin of chinese.plugins) expect(plugin.name, plugin.id).toMatch(han);
    const installed = (await plugins.listPlugins()).plugins;
    expect(installed.find((plugin) => plugin.id === 'todo')).toMatchObject({
      name: '任务清单', extension: { trust: 'trusted' },
    });
    const chineseSkill = await skills.getSkill('documents.documents');
    expect(chineseSkill?.content).toContain('# Word 文档处理');
    expect(chineseSkill?.contentVersion).not.toBe(englishSkill?.contentVersion);
    expect(await plugins.readItemContent('documents', 'skill', 'documents.documents')).toMatchObject({
      files: [expect.objectContaining({ text: expect.stringContaining('# Word 文档处理') })],
    });
    expect(await plugins.readResource('documents', 'content-spec')).toMatchObject({
      text: expect.stringContaining('# DOCX 内容规格'),
    });
    expect((await skills.resolvePromptContext([], { text: 'Need library documentation' })).selectedInjections)
      .toEqual([expect.objectContaining({ id: 'context7-docs.context7-docs' })]);
    expect(await readFile(path.join(root, 'plugins.json'), 'utf8')).toBe(before);
    for (const record of records.filter((plugin) => plugin.extension)) {
      expect((await inspectBundleTree(record.installPath)).bundleHash).toBe(record.extension?.trustedHash);
    }
    await skills.updateSkill('documents.documents', { name: 'My 文档', content: '# 自定义 workflow' });
    await language('en-US');
    expect(await skills.getSkill('documents.documents')).toMatchObject({ name: 'My 文档', content: '# 自定义 workflow' });
    // 旧安装副本没有翻译文件时，展示仍可使用当前应用的文案，不改写安装记录。
    const todo = records.find((plugin) => plugin.id === 'todo')!;
    await rm(path.join(todo.installPath, '.setsuna-plugin', 'i18n.json'));
    expect((await plugins.listPlugins()).plugins.find((plugin) => plugin.id === 'todo')?.name).toBe('Todo List');
  });

  it('updates cached extension tool descriptions and result language without translating parameters or user content', async () => {
    const { plugins, marketplace, language, state, config } = await fixture();
    await marketplace.installPlugin('todo');
    const manager = new ExtensionManager(plugins, state, { handle: async () => null }, {
      bundledPluginsDir: catalogRoot,
      getLanguage: async () => (await config.getConfig()).desktopSettings?.interfaceLanguage ?? 'zh-CN',
      workerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      workerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
    });
    try {
      const zhContext = { threadId: 'thread', turnId: 'turn', interfaceLanguage: 'zh-CN' as const };
      const [chinese] = await manager.listTools(zhContext);
      expect(chinese.description).toMatch(han);
      const enContext = { ...zhContext, interfaceLanguage: 'en-US' as const };
      const [english] = await manager.listTools(enContext);
      expect(english.description).not.toMatch(han);
      expect(withoutDescriptions(chinese.inputSchema)).toEqual(withoutDescriptions(english.inputSchema));
      expect(chinese.name).toBe(english.name);
      const input = { action: 'add', text: '保留用户内容' };
      expect(await manager.runTool(chinese.name, input, zhContext)).toMatchObject({ content: '已添加任务 #1：保留用户内容' });
      await language('en-US');
      expect(await manager.runTool(english.name, input, enContext)).toMatchObject({ content: 'Added todo #2: 保留用户内容' });
      expect((await manager.listStatuses()).extensions[0]?.tools[0]?.description).not.toMatch(han);
    } finally {
      await manager.shutdown();
    }
  });

  it('does not translate a local plugin that reuses a bundled ID or mutate executable schema fields', async () => {
    const { plugins, language } = await fixture();
    await language('en-US');
    const installed = await plugins.installPlugin({ path: path.join(catalogRoot, 'todo') });
    expect(installed.plugin).toMatchObject({ installationSource: 'local', name: '任务清单' });
    const schema = {
      name: 'Do not translate', description: 'Translate me',
      properties: { description: { type: 'string', description: 'Translate me', enum: ['Translate me'] } },
      default: { text: 'Translate me' }, enum: [{ label: 'Translate me' }],
      required: ['description'], additionalProperties: false,
    };
    expect(localizePluginDisplayFields(schema, { 'Translate me': '翻译', 'Do not translate': '错误' })).toEqual({
      ...schema, description: '翻译',
      properties: { description: { ...schema.properties.description, description: '翻译' } },
    });
    expect(schema.description).toBe('Translate me');
  });

  it('provides Chinese descriptions for every bundled extension tool and preserves the executable schema', async () => {
    const { marketplace } = await fixture();
    let toolCount = 0;
    for (const plugin of (await marketplace.listPlugins()).plugins) {
      if (!plugin.extension?.capabilities.includes('tools')) continue;
      const root = path.join(catalogRoot, plugin.id);
      const tools: Array<{ description: string; inputSchema: Record<string, unknown> }> = [];
      const extension = await import(pathToFileURL(path.join(root, 'extension', 'entry.mjs')).href);
      await extension.default({ registerTool: (tool: typeof tools[number]) => tools.push(tool), onUiAction: () => undefined });
      const messages = await readBundledPluginMessages(root, 'zh-CN');
      for (const tool of tools) {
        toolCount += 1;
        const chinese = localizePluginDisplayFields(tool, messages);
        expect(chinese.description, plugin.id).toMatch(han);
        expect(withoutDescriptions(chinese.inputSchema), plugin.id).toEqual(withoutDescriptions(tool.inputSchema));
        for (const description of schemaDescriptions(chinese.inputSchema)) expect(description, plugin.id).toMatch(han);
      }
    }
    expect(toolCount).toBeGreaterThan(0);
  });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-bundled-locales-'));
  roots.push(root);
  const config = new FileConfigStore(root);
  const language = async (interfaceLanguage: RuntimeInterfaceLanguage) => {
    const current = await config.getConfig();
    await config.saveConfig({ desktopSettings: { ...current.desktopSettings, interfaceLanguage } });
  };
  await language('zh-CN');
  const skills = new FileSkillRegistry(path.resolve('skills'), root, {
    bundledPluginsDir: catalogRoot,
    getLanguage: async () => (await config.getConfig()).desktopSettings?.interfaceLanguage ?? 'zh-CN',
  });
  const state = new FileExtensionStateStore(root);
  const plugins = new FilePluginBundleStore(root, skills,
    new FileMcpStore(root, new InMemoryDesktopNativeBridge()),
    { invalidateServer: async () => undefined }, config, systemClock, state, catalogRoot);
  return { root, config, language, skills, plugins, state, marketplace: new FilePluginMarketplace(catalogRoot, plugins) };
}

function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key, field]) => !(key === 'description' && typeof field === 'string'))
    .map(([key, field]) => [key, withoutDescriptions(field)]));
}

function schemaDescriptions(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, field]) => key === 'description' && typeof field === 'string'
    ? [field] : schemaDescriptions(field));
}
