import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePluginBundleStore } from '../../../src/adapters/plugin/file-plugin-bundle-store.js';
import { FilePluginMarketplace } from '../../../src/adapters/plugin/file-plugin-marketplace.js';
import { inspectBundleTree } from '../../../src/adapters/plugin/file-plugin-bundle-model.js';
import { localizePluginDisplayFields, readBundledPluginMessages } from '../../../src/adapters/plugin/bundled-plugin-localization.js';
import { FileSkillRegistry } from '../../../src/adapters/skill/file-skill-registry.js';
import { FileConfigStore } from '../../../src/adapters/store/file-config-store.js';
import { FileMcpStore } from '../../../src/adapters/store/file-mcp-store.js';
import { FileExtensionStateStore } from '../../../src/extensions/file-extension-state-store.js';
import { ExtensionManager } from '../../../src/extensions/extension-manager.js';
import { systemClock } from '../../../src/ports/clock.js';
import { InMemoryDesktopNativeBridge } from '../../support/in-memory-secret-store.js';

const roots: string[] = [];
const catalogRoot = path.resolve('plugins');
const han = /\p{Script=Han}/u;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundled content localization', () => {
  it('switches every built-in Skill catalog, detail, and prompt without changing IDs or enabled state', async () => {
    const { skills, language } = await fixture();
    const chinese = await skills.listSkills();
    const ids = chinese.skills.map((skill) => skill.id).sort();
    expect(ids).toEqual(['create-mcp-in-chat', 'create-plugin-in-chat', 'create-skill-in-chat', 'goal-writer']);
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
    await marketplace.installPlugin('question');
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
    expect(installed.find((plugin) => plugin.id === 'question')).toMatchObject({
      name: '结构化提问', extension: { trust: 'trusted' },
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
    const question = records.find((plugin) => plugin.id === 'question')!;
    await rm(path.join(question.installPath, '.setsuna-plugin', 'i18n.json'));
    expect((await plugins.listPlugins()).plugins.find((plugin) => plugin.id === 'question')?.name).toBe('Structured Questions');
  });

  it('updates cached extension tool descriptions and UI language without translating parameters or user answers', async () => {
    const { plugins, marketplace, language, state, config } = await fixture();
    await marketplace.installPlugin('question');
    const handle = vi.fn(async (_method: string, _params: unknown) => '0');
    const manager = new ExtensionManager(plugins, state, { handle }, {
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
      const input = { question: '保留用户问题', options: [{ label: '保留回答' }, { label: 'Other' }] };
      expect(await manager.runTool(chinese.name, input, zhContext)).toMatchObject({ content: '用户选择了第 1 项：保留回答' });
      expect(handle.mock.calls[0]?.[1]).toMatchObject({ title: '结构化提问', message: input.question });
      await language('en-US');
      expect(await manager.runTool(english.name, input, enContext)).toMatchObject({ content: 'User selected 1: 保留回答' });
      expect(handle.mock.calls[1]?.[1]).toMatchObject({ title: 'Structured Question', message: input.question });
      expect((await manager.listStatuses()).extensions[0]?.tools[0]?.description).not.toMatch(han);
    } finally {
      await manager.shutdown();
    }
  });

  it('does not translate a local plugin that reuses a bundled ID or mutate executable schema fields', async () => {
    const { plugins, language } = await fixture();
    await language('en-US');
    const installed = await plugins.installPlugin({ path: path.join(catalogRoot, 'question') });
    expect(installed.plugin).toMatchObject({ installationSource: 'local', name: '结构化提问' });
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
