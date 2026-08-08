import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CapabilitiesPluginDetail } from '../../../../src/features/capabilities/CapabilitiesPluginDetail.js';
import {
  CapabilitiesPluginFilePreview,
  markdownPreviewBody,
} from '../../../../src/features/capabilities/CapabilitiesPluginItemDialog.js';
import { CapabilitiesPluginListItem } from '../../../../src/features/capabilities/CapabilitiesPluginListItem.js';
import { CapabilitiesPluginMarket } from '../../../../src/features/capabilities/CapabilitiesPluginMarket.js';

describe('capabilities plugin components', () => {
  it('renders a one-click marketplace row without card chrome or local paths', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginListItem
        plugin={{
          id: 'openai-docs',
          name: 'OpenAI 官方文档',
          icon: 'openai-docs',
          version: '1.0.0',
          description: '查询最新官方开发文档。',
          publisher: 'OpenAI',
          tags: ['官方', '开发文档'],
          featured: true,
          skills: [{ id: 'openai-docs.openai-docs', name: 'OpenAI 官方文档', description: '查询 OpenAI 官方文档。' }],
          mcpServers: [{ key: 'openai_docs', label: 'OpenAI Developer Docs', description: '官方文档服务', transport: 'streamableHttp' }],
          hooks: [],
          resources: [],
          capabilities: { skills: 1, mcpServers: 1, hooks: 0, resources: 0 },
          installed: false,
          updateAvailable: false,
        }}
        installing={false}
        onInstall={async () => undefined}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain('OpenAI 官方文档');
    expect(html).toContain('1 个技能');
    expect(html).toContain('1 个服务');
    expect(html).toContain('获取');
    expect(html).not.toContain('desktop-capability-card');
    expect(html).not.toContain('目录');
    expect(html).not.toContain('plugin.json');
  });

  it('shows inspectable Skill and MCP details before plugin installation', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        marketplacePlugin={{
          id: 'docs-plugin',
          name: 'Docs Plugin',
          version: '1.0.0',
          description: 'Documentation tools.',
          publisher: 'Setsuna',
          tags: ['docs'],
          featured: true,
          skills: [{ id: 'docs-plugin.skill', name: 'Docs Skill', description: 'Read project documentation.' }],
          mcpServers: [{ key: 'docs_server', label: 'Docs Server', description: 'Search project documentation.', transport: 'streamableHttp' }],
          hooks: [],
          resources: [{ id: 'docs-guide', label: 'Docs Guide', path: 'resources/guide.md', size: 1024 }],
          capabilities: { skills: 1, mcpServers: 1, hooks: 0, resources: 1 },
          installed: false,
          updateAvailable: false,
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );
    expect(html).toContain('Read project documentation.');
    expect(html).toContain('Search project documentation.');
    expect(html).toMatch(/aria-label="[^"]*Docs Skill[^"]*"/u);
    expect(html).toMatch(/aria-label="[^"]*Docs Server[^"]*"/u);
    expect(html).toMatch(/aria-label="[^"]*Docs Guide[^"]*"/u);
  });

  it('offers an update for an installed marketplace plugin with a newer bundled version', () => {
    const marketplacePlugin = {
      id: 'openai-image-generation',
      name: '图片生成',
      icon: 'image-generation',
      version: '1.0.1',
      description: '通过 Images API 生成图片。',
      publisher: 'Setsuna',
      tags: ['图片'],
      featured: true,
      skills: [{ id: 'openai-image-generation.image-generation', name: '图片生成' }],
      mcpServers: [],
      hooks: [],
      resources: [],
      capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
      installed: true,
      installedVersion: '1.0.0',
      updateAvailable: true,
    } satisfies RuntimePluginMarketplaceItem;
    const rowHtml = renderToStaticMarkup(
      <CapabilitiesPluginListItem
        plugin={marketplacePlugin}
        installing={false}
        onInstall={async () => undefined}
        onOpen={() => undefined}
      />,
    );
    const loadingRowHtml = renderToStaticMarkup(
      <CapabilitiesPluginListItem
        plugin={marketplacePlugin}
        installing
        onInstall={async () => undefined}
        onOpen={() => undefined}
      />,
    );
    const detailHtml = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error="更新插件失败：EPERM"
        installedPlugin={{
          id: marketplacePlugin.id,
          name: marketplacePlugin.name,
          icon: marketplacePlugin.icon,
          version: '1.0.0',
          installedAt: '2026-07-17T00:00:00.000Z',
          skills: marketplacePlugin.skills,
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }}
        installing={false}
        marketplacePlugin={marketplacePlugin}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );

    expect(rowHtml).toContain('aria-label="更新：图片生成"');
    expect(rowHtml).not.toContain('disabled=""');
    expect(loadingRowHtml).toContain('aria-label="更新中：图片生成"');
    expect(loadingRowHtml).toContain('disabled=""');
    expect(detailHtml).toContain('更新到 v1.0.1');
    expect(detailHtml).toContain('卸载');
    expect(detailHtml).toContain('role="alert">更新插件失败：EPERM');
    expect(detailHtml.indexOf('更新插件失败：EPERM')).toBeLessThan(detailHtml.indexOf('desktop-capabilities-plugin-detail__hero'));
  });

  it('composes installed shortcuts with the featured plugin catalog', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginMarket
        marketplacePlugins={[{
          id: 'demo-plugin',
          name: 'Demo Plugin',
          version: '1.0.0',
          description: 'Demo capabilities.',
          publisher: 'Setsuna',
          tags: ['demo'],
          featured: true,
          skills: [{ id: 'demo-plugin.skill', name: 'Demo Skill' }],
          mcpServers: [],
          hooks: [],
          resources: [],
          capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
          installed: true,
          updateAvailable: false,
        }]}
        localPlugins={[]}
        installingPluginIds={new Set()}
        onInstall={async () => undefined}
        onOpenLocal={() => undefined}
        onOpenMarketplace={() => undefined}
      />,
    );

    expect(html).toContain('desktop-plugin-market__installed');
    expect(html).toContain('desktop-plugin-list-item');
    expect(html).toContain('Demo Plugin');
  });

  it('keeps Hook cards user-facing without exposing runtime identifiers', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        marketplacePlugin={{
          id: 'guard-dangerous-shell',
          name: '阻止危险 Shell 命令',
          icon: 'guard-dangerous-shell',
          description: '拦截高危命令。',
          publisher: 'Setsuna',
          tags: ['安全'],
          featured: true,
          skills: [],
          mcpServers: [],
          hooks: [{
            id: 'guard-dangerous-shell',
            name: '阻止危险 Shell 命令',
            description: '在工具执行前识别破坏性命令。',
            eventName: 'PreToolUse',
            matcher: 'run_shell_command|exec_command',
          }],
          resources: [],
          capabilities: { skills: 0, mcpServers: 0, hooks: 1, resources: 0 },
          installed: false,
          updateAvailable: false,
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );

    expect(html).toContain('在工具执行前识别破坏性命令');
    expect(html).not.toContain('PreToolUse');
    expect(html).not.toContain('run_shell_command|exec_command');
    expect(html).not.toContain('{{pluginRoot}}');
    expect(html).not.toContain('.mjs');
  });

  it('renders private Images API settings only for the installed image plugin', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        imageGenerationConfig={{
          baseUrl: 'http://127.0.0.1:8000',
          model: 'gpt-image-1',
          apiKeySet: true,
          apiKeyPreview: 'ima••••cret',
        }}
        installing={false}
        installedPlugin={{
          id: 'openai-image-generation',
          name: '图片生成',
          icon: 'image-generation',
          installedAt: '2026-07-17T00:00:00.000Z',
          skills: [{ id: 'openai-image-generation.image-generation', name: '图片生成' }],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onSaveImageGenerationConfig={async () => undefined}
        onTestImageGeneration={async () => ({ images: [], durationMs: 0 })}
      />,
    );

    expect(html).toContain('desktop-image-generation-settings');
    expect(html).toContain('http://127.0.0.1:8000');
    expect(html).toContain('gpt-image-1');
    expect(html).toContain('当前使用 HTTP');
    expect(html).toContain('快速测试');
    expect(html).toContain('保存配置并生成');
    expect(html).toContain('测试请求只携带提示词');
    expect(html).not.toContain('>启用<');
    expect(html).not.toContain('image-secret');
  });

  it('selects an existing image-capable model and lists the installed vision tool', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        runtimeConfig={{
          configPath: 'C:\\runtime\\config.json',
          dataPath: 'C:\\runtime',
          storagePath: 'C:\\runtime\\memories',
          activeProviderId: 'vision-provider',
          providers: [{
            id: 'vision-provider',
            name: '已配置视觉服务',
            provider: 'openai-compatible',
            baseUrl: 'http://127.0.0.1:9000/v1',
            enabled: true,
            apiKeySet: true,
            apiKeyPreview: 'vis••••cret',
            models: [{
              id: 'vision-model',
              name: 'Qwen Vision',
              code: 'qwen-vl-max',
              enabled: true,
              maxOutputTokens: 8_192,
              thinkingEnabled: false,
              thinkingEfforts: [],
              supportsImages: true,
            }],
          }],
          globalPrompt: '',
          memory: {
            useMemories: false,
            generateMemories: false,
            disableOnExternalContext: false,
          },
          memoryEnabled: false,
          setsunaStyle: 'developer',
          approvalPolicy: 'on-request',
          permissionProfile: 'workspace-write',
          visionRecognition: { providerId: 'vision-provider', modelId: 'vision-model' },
        }}
        installing={false}
        installedPlugin={{
          id: 'openai-vision-recognition',
          name: '视觉识别',
          icon: 'vision-recognition',
          installedAt: '2026-08-08T00:00:00.000Z',
          tools: [{
            name: 'analyze_image',
            description: '使用已配置视觉模型分析当前会话中的图片附件。',
          }],
          skills: [{ id: 'openai-vision-recognition.vision-recognition', name: '视觉识别' }],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onSaveVisionRecognitionConfig={async () => undefined}
        onTestVisionRecognition={async () => ({ content: 'Image received.', durationMs: 0 })}
      />,
    );

    expect(html).toContain('desktop-vision-recognition-settings');
    expect(html).toContain('已配置视觉服务 · Qwen Vision (qwen-vl-max)');
    expect(html).toContain('qwen-vl-max');
    expect(html).toContain('这里只显示已启用服务中标记为支持图片的模型');
    expect(html).toContain('内置测试图片');
    expect(html).toContain('测试模型');
    expect(html).toContain('analyze_image');
    expect(html).toContain('使用已配置视觉模型分析当前会话中的图片附件。');
    expect(html).not.toContain('http://127.0.0.1:9000/v1');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('vision-secret');
  });

  it('renders Markdown files by default while keeping a source view available', () => {
    const markdown = [
      '---',
      'name: Demo Skill',
      'description: Markdown preview fixture',
      '---',
      '# 使用说明',
      '',
      '| 能力 | 状态 |',
      '| --- | --- |',
      '| 预览 | 支持 |',
    ].join('\n');
    const html = renderToStaticMarkup(
      <CapabilitiesPluginFilePreview
        file={{
          path: 'skills/demo/SKILL.md',
          mimeType: 'text/markdown',
          size: markdown.length,
          text: markdown,
        }}
      />,
    );
    const plainTextHtml = renderToStaticMarkup(
      <CapabilitiesPluginFilePreview
        file={{
          path: 'hooks/protect-secret-paths.mjs',
          mimeType: 'text/javascript',
          size: 25,
          text: 'export const hook = true;',
        }}
      />,
    );

    expect(html).toContain('<h1>使用说明</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('预览');
    expect(html).toContain('源码');
    expect(html).not.toContain('name: Demo Skill');
    expect(markdownPreviewBody('普通 Markdown')).toBe('普通 Markdown');
    expect(markdownPreviewBody('---\n分隔内容\n---\n正文')).toBe('---\n分隔内容\n---\n正文');
    expect(plainTextHtml).toMatch(/<pre aria-label="[^"]+" tabindex="0">export const hook = true;<\/pre>/);
  });
});
