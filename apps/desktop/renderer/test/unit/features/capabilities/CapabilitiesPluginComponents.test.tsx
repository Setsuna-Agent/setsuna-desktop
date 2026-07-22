import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CapabilitiesInstalledPluginListItem,
} from '../../../../src/features/capabilities/CapabilitiesInstalledPluginListItem.js';
import { CapabilitiesPluginDetail } from '../../../../src/features/capabilities/CapabilitiesPluginDetail.js';
import { CapabilitiesPluginEditorial } from '../../../../src/features/capabilities/CapabilitiesPluginEditorial.js';
import { CapabilitiesPluginIcon } from '../../../../src/features/capabilities/CapabilitiesPluginIcon.js';
import {
  CapabilitiesPluginFilePreview,
  markdownPreviewBody,
} from '../../../../src/features/capabilities/CapabilitiesPluginItemDialog.js';
import { CapabilitiesPluginListItem } from '../../../../src/features/capabilities/CapabilitiesPluginListItem.js';

describe('capabilities plugin components', () => {
  it('renders an installed local plugin as a lightweight list row', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesInstalledPluginListItem
        plugin={{
          id: 'demo',
          name: 'Demo Plugin',
          icon: 'context7',
          version: '1.2.3',
          description: 'Local plugin fixture',
          publisher: 'Setsuna',
          tags: ['文档'],
          installedAt: '2026-07-15T00:00:00.000Z',
          skills: [{ id: 'demo.docs', name: 'Docs', description: 'Read project documentation.' }],
          mcpServers: [{ key: 'demo_docs', label: 'Demo Docs', description: 'Search documentation.', transport: 'streamableHttp', owned: true }],
          hooks: [{ id: 'demo-audit', name: 'Audit changes', eventName: 'PostToolUse' }],
          hookCount: 1,
          resources: [{ id: 'guide', label: 'Guide', path: 'resources/guide.md', size: 8 }],
        }}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain('Demo Plugin');
    expect(html).toContain('已安装');
    expect(html).toContain('查看');
    expect(html).not.toContain('desktop-capability-card');
    expect(html).not.toContain('卸载');
  });

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

  it('renders a featured plugin as editorial artwork instead of a card', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginEditorial
        plugin={{
          id: 'pdf',
          name: 'PDF 文档处理',
          icon: 'pdf',
          version: '1.0.0',
          description: '读取、创建和验证 PDF。',
          publisher: 'Setsuna',
          tags: ['PDF'],
          featured: true,
          skills: [{ id: 'pdf.pdf', name: 'PDF' }],
          mcpServers: [],
          hooks: [],
          resources: [],
          capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
          installed: false,
          updateAvailable: false,
        }}
        installing={false}
        onInstall={async () => undefined}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain('desktop-plugin-editorial__art');
    expect(html).toContain('获取');
    expect(html).not.toContain('编辑推荐');
    expect(html).not.toContain('desktop-capability-card');
  });

  it('shows the skills and MCP servers included in a marketplace plugin before installation', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        marketplacePlugin={{
          id: 'openai-docs',
          name: 'OpenAI 官方文档',
          icon: 'openai-docs',
          version: '1.0.0',
          description: '查询最新官方开发文档。',
          publisher: 'OpenAI',
          tags: ['官方', '开发文档'],
          featured: true,
          skills: [{ id: 'openai-docs.openai-docs', name: 'OpenAI 官方文档', description: '查询 OpenAI API 与 Codex 文档。' }],
          mcpServers: [{ key: 'openai_docs', label: 'OpenAI Developer Docs', description: 'OpenAI 官方文档服务', transport: 'streamableHttp' }],
          hooks: [],
          resources: [],
          capabilities: { skills: 1, mcpServers: 1, hooks: 0, resources: 0 },
          installed: false,
          updateAvailable: false,
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );

    expect(html).toContain('OpenAI 官方文档');
    expect(html).toContain('OpenAI API 与 Codex 文档');
    expect(html).toContain('OpenAI Developer Docs');
    expect(html).toContain('远程 MCP');
    expect(html).toContain('查看 OpenAI 官方文档 详情');
    expect(html).toContain('查看 OpenAI Developer Docs 详情');
    expect(html).toContain('安装插件');
    expect(html).not.toContain('openai-docs.openai-docs');
    expect(html).not.toContain('openai_docs');
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

  it('aligns declared resources with the other detail sections and makes each resource inspectable', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        installedPlugin={{
          id: 'documents',
          name: 'Word 文档处理',
          installedAt: '2026-07-15T00:00:00.000Z',
          skills: [{ id: 'documents.documents', name: 'Word 文档处理' }],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [
            { id: 'content-spec', label: 'DOCX 内容模型', path: 'skills/documents/references/content-spec.md', size: 2048 },
            { id: 'sample-document-spec', label: '示例文档内容', path: 'skills/documents/examples/sample-document.json', size: 512 },
          ],
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );

    expect(html).toContain('desktop-capabilities-plugin-detail__section-title">资源</span>');
    expect(html).toContain('查看 DOCX 内容模型 详情');
    expect(html).toContain('查看 示例文档内容 详情');
    expect(html).toContain('2.0 KB');
    expect(html).not.toContain('documents.documents');
    expect(html).not.toContain('<code>');
    expect(html.match(/aria-expanded="true"/gu)).toHaveLength(4);
    expect(html.match(/desktop-capabilities-plugin-detail__section-content/gu)).toHaveLength(4);
    expect(html).toContain('这个插件不包含 MCP 服务。');
    expect(html).toContain('这个插件不包含 Hook。');
    expect(html).not.toContain(' hidden=""');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('desktop-capabilities-plugin-detail__extras');
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

    expect(html).toContain('<h1>使用说明</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('预览');
    expect(html).toContain('源码');
    expect(html).not.toContain('name: Demo Skill');
    expect(markdownPreviewBody('普通 Markdown')).toBe('普通 Markdown');
    expect(markdownPreviewBody('---\n分隔内容\n---\n正文')).toBe('---\n分隔内容\n---\n正文');
  });

  it('keeps plain-text file content in a keyboard-scrollable preview region', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginFilePreview
        file={{
          path: 'hooks/protect-secret-paths.mjs',
          mimeType: 'text/javascript',
          size: 180,
          text: `const matcher = /${'sensitive-path|'.repeat(24)}/;`,
        }}
      />,
    );

    expect(html).toContain('<pre aria-label="protect-secret-paths.mjs 文件内容" tabindex="0">');
    expect(html).toContain('sensitive-path|sensitive-path');
  });

  it('renders a distinct glyph and tone for every bundled plugin icon', () => {
    const names = [
      'context7',
      'openai-docs',
      'pdf',
      'documents',
      'image-generation',
      'guard-dangerous-shell',
      'protect-secret-paths',
      'protect-generated-folders',
      'audit-file-mutations',
      'session-start-project-guidance',
      'prompt-secret-detector',
      'compact-warning',
      'stop-todo-continuation',
    ];
    const icons = names.map((name) =>
      renderToStaticMarkup(<CapabilitiesPluginIcon name={name} />));

    names.forEach((name, index) => expect(icons[index]).toContain(`data-plugin-icon="${name}"`));
    expect(new Set(icons).size).toBe(names.length);
  });
});
