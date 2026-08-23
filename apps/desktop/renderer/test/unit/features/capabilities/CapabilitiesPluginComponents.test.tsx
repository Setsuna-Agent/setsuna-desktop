// @vitest-environment happy-dom

import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilitiesPluginDetail } from '../../../../src/features/capabilities/CapabilitiesPluginDetail.js';
import { CapabilitiesLegacyHooksDetail } from '../../../../src/features/capabilities/CapabilitiesLegacyHooksDetail.js';
import {
  CapabilitiesPluginFilePreview,
  markdownPreviewBody,
} from '../../../../src/features/capabilities/CapabilitiesPluginItemDialog.js';
import { CapabilitiesPluginListItem } from '../../../../src/features/capabilities/CapabilitiesPluginListItem.js';
import { CapabilitiesPluginMarket } from '../../../../src/features/capabilities/CapabilitiesPluginMarket.js';

describe('capabilities plugin components', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    expect(html).toContain('desktop-capabilities-plugin-detail__description');
    expect(html).not.toContain('desktop-capabilities-plugin-detail__hero');
    expect(html).not.toContain('desktop-capabilities-plugin-detail__badges');
    expect(html).toMatch(/aria-label="[^"]*Docs Skill[^"]*"/u);
    expect(html).toMatch(/aria-label="[^"]*Docs Server[^"]*"/u);
    expect(html).toMatch(/aria-label="[^"]*Docs Guide[^"]*"/u);
  });

  it('shows Plugin Skill switches and keeps a removed Skill switched off', async () => {
    const onSetSkillEnabled = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(
      <CapabilitiesPluginDetail
        error={null}
        installedPlugin={{
          id: 'docs-plugin',
          name: 'Docs Plugin',
          installedAt: '2026-08-14T00:00:00.000Z',
          skills: [
            { id: 'docs-plugin.active', name: 'Active Skill' },
            { id: 'docs-plugin.removed', name: 'Removed Skill' },
          ],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }}
        runtimeSkills={[{
          id: 'docs-plugin.active',
          name: 'Active Skill',
          kind: 'plugin',
          pluginId: 'docs-plugin',
          enabled: false,
        }]}
        installing={false}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onSetSkillEnabled={onSetSkillEnabled}
      />,
    );

    const activeSwitch = screen.getByRole('checkbox', { name: '启用或停用 Active Skill' });
    const removedSwitch = screen.getByRole('checkbox', { name: '启用或停用 Removed Skill' });
    expect(activeSwitch.hasAttribute('disabled')).toBe(false);
    expect(removedSwitch.hasAttribute('disabled')).toBe(true);
    expect((removedSwitch as HTMLInputElement).checked).toBe(false);

    await user.click(activeSwitch);
    expect(onSetSkillEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'docs-plugin.active' }),
      true,
    );
  });

  it('shows local executable extension trust, process state, and the unsandboxed warning', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        extensionStatus={{
          pluginId: 'worker-demo',
          state: 'failed',
          tools: [],
          events: [],
          error: 'worker exited',
        }}
        installedPlugin={{
          id: 'worker-demo',
          name: 'Worker Demo',
          installedAt: '2026-08-09T00:00:00.000Z',
          installationSource: 'local',
          skills: [],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
          extension: {
            apiVersion: 1,
            runtime: 'node-worker',
            capabilities: ['tools', 'events', 'ui', 'state'],
            trust: 'modified',
          },
        }}
        installing={false}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onSetExtensionTrust={async () => undefined}
      />,
    );

    expect(html).toContain('可执行扩展');
    expect(html).toContain('包内容已变更');
    expect(html).toContain('不是操作系统沙箱');
    expect(html).toContain('运行失败');
    expect(html).toContain('worker exited');
    expect(html).toContain('信任并允许运行');
  });

  it('keeps the revoke action visible for a healthy trusted local extension', async () => {
    const onSetExtensionTrust = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(
      <CapabilitiesPluginDetail
        error={null}
        extensionStatus={{
          pluginId: 'worker-demo',
          state: 'running',
          tools: [],
          events: [],
        }}
        installedPlugin={{
          id: 'worker-demo',
          name: 'Worker Demo',
          installedAt: '2026-08-09T00:00:00.000Z',
          installationSource: 'local',
          skills: [],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
          extension: {
            apiVersion: 1,
            runtime: 'node-worker',
            capabilities: ['tools', 'ui'],
            trust: 'trusted',
          },
        }}
        installing={false}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onSetExtensionTrust={onSetExtensionTrust}
      />,
    );

    expect(screen.getByText('已信任当前包')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '撤销运行信任' }));
    expect(onSetExtensionTrust).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'worker-demo' }),
      false,
    );
  });

  it('hides healthy bundled executable extension status', () => {
    const marketplacePlugin = {
      id: 'question',
      name: '澄清问题',
      version: '1.0.1',
      description: '在执行前向用户提出结构化问题。',
      publisher: 'Setsuna',
      tags: ['交互'],
      featured: true,
      skills: [],
      mcpServers: [],
      hooks: [],
      resources: [],
      extension: {
        apiVersion: 1,
        runtime: 'node-worker',
        capabilities: ['tools', 'ui'],
      },
      capabilities: { skills: 0, mcpServers: 0, hooks: 0, resources: 0, extension: 1 },
      installed: true,
      updateAvailable: false,
    } satisfies RuntimePluginMarketplaceItem;
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        extensionStatus={{
          pluginId: marketplacePlugin.id,
          state: 'running',
          tools: [],
          events: [],
        }}
        installedPlugin={{
          id: marketplacePlugin.id,
          name: marketplacePlugin.name,
          version: marketplacePlugin.version,
          publisher: 'Pi ecosystem / Setsuna port',
          tags: ['Pi'],
          installedAt: '2026-08-09T00:00:00.000Z',
          installationSource: 'marketplace',
          skills: [],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [{
            id: 'upstream-notice',
            label: '上游来源与兼容说明',
            path: 'resources/UPSTREAM.md',
            size: 1_638,
          }],
          extension: {
            ...marketplacePlugin.extension,
            trust: 'trusted',
          },
        }}
        installing={false}
        marketplacePlugin={marketplacePlugin}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onSetExtensionTrust={async () => undefined}
      />,
    );

    expect(html).not.toContain('desktop-capabilities-plugin-detail__extension');
    expect(html).not.toContain('已信任当前包');
    expect(html).not.toContain('撤销运行信任');
    expect(html).not.toContain('信任并允许运行');
    expect(html).not.toContain('Pi ecosystem');
    expect(html).not.toContain('>Pi<');
    expect(html).not.toContain('上游来源与兼容说明');
    expect(html).not.toContain('resources/UPSTREAM.md');
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
          installationSource: 'marketplace',
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
    expect(detailHtml).toContain('aria-label="更多操作"');
    expect(detailHtml).toContain('role="alert">更新插件失败：EPERM');
    expect(detailHtml.indexOf('更新插件失败：EPERM')).toBeLessThan(detailHtml.indexOf('desktop-capabilities-plugin-detail__section'));
  });

  it('keeps installed capabilities readable until a marketplace update is applied', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installedPlugin={{
          id: 'versioned-plugin',
          name: 'Versioned Plugin',
          version: '1.0.0',
          installedAt: '2026-08-01T00:00:00.000Z',
          installationSource: 'marketplace',
          skills: [],
          mcpServers: [],
          hooks: [{ id: 'installed-hook', name: 'Installed Hook', eventName: 'PostToolUse' }],
          hookCount: 1,
          resources: [
            { id: 'shared-guide', label: 'Installed Guide', path: 'resources/guide.md', size: 12 },
            { id: 'removed-notice', label: 'Removed Notice', path: 'resources/old.md', size: 8 },
          ],
        }}
        marketplacePlugin={{
          id: 'versioned-plugin',
          name: 'Versioned Plugin',
          version: '2.0.0',
          publisher: 'Setsuna',
          tags: [],
          featured: false,
          skills: [],
          mcpServers: [],
          hooks: [
            { id: 'installed-hook', name: 'Updated Hook Copy', eventName: 'PostToolUse' },
            { id: 'catalog-only-hook', name: 'Catalog-only Hook', eventName: 'PreToolUse' },
          ],
          resources: [
            { id: 'shared-guide', label: 'Catalog Guide', path: 'resources/guide.md', size: 14 },
            { id: 'catalog-only-guide', label: 'Catalog-only Guide', path: 'resources/new.md', size: 16 },
          ],
          capabilities: { skills: 0, mcpServers: 0, hooks: 2, resources: 2 },
          installed: true,
          installedVersion: '1.0.0',
          updateAvailable: true,
        }}
        installing={false}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );

    expect(html).toContain('Installed Hook');
    expect(html).toContain('Installed Guide');
    expect(html).not.toContain('Catalog-only Hook');
    expect(html).not.toContain('Catalog-only Guide');
    expect(html).not.toContain('Removed Notice');
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
    expect(html).toContain('desktop-capability-list-item');
    expect(html).toContain('Demo Plugin');
    expect(html).toContain('aria-label="查看已安装插件：Demo Plugin"');
    expect(html).not.toContain('开发者选项');
    expect(html).not.toContain('导入本地插件');
  });

  it('keeps legacy standalone Hooks manageable from the plugin surface', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesLegacyHooksDetail
        hooks={[{
          key: 'C:\\runtime\\config.json:pre_tool_use:0:0',
          eventName: 'preToolUse',
          handlerType: 'command',
          matcher: 'shell',
          command: 'echo checked',
          timeoutSec: 30,
          statusMessage: null,
          sourcePath: 'C:\\runtime\\config.json',
          source: 'user',
          pluginId: null,
          displayOrder: 0,
          enabled: true,
          isManaged: false,
          currentHash: 'hash',
          trustStatus: 'trusted',
        }]}
        onBack={() => undefined}
        onDelete={async () => undefined}
        onSetEnabled={async () => undefined}
        onSetTrust={async () => undefined}
      />,
    );

    expect(html).toContain('旧版独立 Hooks');
    expect(html).toContain('echo checked');
    expect(html).toContain('aria-label="撤销命令信任"');
    expect(html).toContain('aria-label="停用 Hook"');
    expect(html).toContain('aria-label="删除 Hook"');
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

  it('lets users trust the current command hash for a side-loaded plugin Hook', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSetHookTrust = vi.fn(async () => undefined);
    const runtimeHook = {
      key: 'C:\\runtime\\plugins\\local-audit\\hooks\\audit.mjs:post_tool_use:0:0',
      eventName: 'postToolUse' as const,
      handlerType: 'command' as const,
      matcher: 'write_file',
      command: 'node audit.mjs',
      timeoutSec: 30,
      statusMessage: null,
      sourcePath: 'C:\\runtime\\plugins\\local-audit\\hooks\\audit.mjs',
      source: 'plugin' as const,
      pluginId: 'local-audit',
      pluginHookId: 'audit',
      displayOrder: 0,
      enabled: true,
      isManaged: false,
      currentHash: 'current-hash',
      trustStatus: 'untrusted' as const,
    };
    render(
      <CapabilitiesPluginDetail
        error={null}
        installedPlugin={{
          id: 'local-audit',
          name: 'Local Audit',
          installationSource: 'local',
          installedAt: '2026-08-09T00:00:00.000Z',
          skills: [],
          mcpServers: [],
          hooks: [{
            id: 'audit',
            name: 'Audit writes',
            eventName: 'PostToolUse',
            matcher: 'write_file',
          }],
          hookCount: 1,
          resources: [],
        }}
        installing={false}
        removing={false}
        runtimeHooks={[
          { ...runtimeHook, key: `${runtimeHook.key}:other`, pluginHookId: 'other', currentHash: 'other-hash' },
          runtimeHook,
        ]}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onSetHookTrust={onSetHookTrust}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Audit writes/u }));
    await userEvent.click(screen.getByRole('button', { name: '信任当前命令' }));
    expect(onSetHookTrust).toHaveBeenCalledWith(runtimeHook, true);
  });

  it('lets users disable an installed marketplace Hook', async () => {
    const onSetHookEnabled = vi.fn(async () => undefined);
    const runtimeHook = {
      key: 'C:\\runtime\\plugins\\guard\\hooks\\guard.mjs:pre_tool_use:0:0',
      eventName: 'preToolUse' as const,
      handlerType: 'command' as const,
      matcher: 'shell',
      command: 'node guard.mjs',
      timeoutSec: 30,
      statusMessage: null,
      sourcePath: 'C:\\runtime\\plugins\\guard\\hooks\\guard.mjs',
      source: 'plugin' as const,
      pluginId: 'guard',
      pluginHookId: 'guard-shell',
      displayOrder: 0,
      enabled: true,
      isManaged: true,
      currentHash: 'managed-hash',
      trustStatus: 'managed' as const,
    };
    const marketplacePlugin = {
      id: 'guard',
      name: 'Guard',
      publisher: 'Setsuna',
      tags: [],
      featured: false,
      skills: [],
      mcpServers: [],
      hooks: [{ id: 'guard-shell', name: 'Guard Shell', eventName: 'PreToolUse' as const }],
      resources: [],
      capabilities: { skills: 0, mcpServers: 0, hooks: 1, resources: 0 },
      installed: true,
      updateAvailable: false,
    } satisfies RuntimePluginMarketplaceItem;
    render(
      <CapabilitiesPluginDetail
        error={null}
        installedPlugin={{
          id: marketplacePlugin.id,
          name: marketplacePlugin.name,
          installedAt: '2026-08-09T00:00:00.000Z',
          installationSource: 'marketplace',
          skills: [],
          mcpServers: [],
          hooks: marketplacePlugin.hooks,
          hookCount: 1,
          resources: [],
        }}
        marketplacePlugin={marketplacePlugin}
        installing={false}
        removing={false}
        runtimeHooks={[runtimeHook]}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
        onSetHookEnabled={onSetHookEnabled}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Guard Shell/u }));
    await userEvent.click(screen.getByRole('button', { name: '停用 Hook' }));
    expect(onSetHookEnabled).toHaveBeenCalledWith(runtimeHook, false);
  });

  it('keeps the plugin detail usable when a Feature settings contribution is absent', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        installedPlugin={{
          id: 'openai-image-generation',
          name: '图片生成',
          icon: 'image-generation',
          installedAt: '2026-07-17T00:00:00.000Z',
          installationSource: 'marketplace',
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
      />,
    );

    expect(html).toContain('图片生成');
    expect(html).not.toContain('data-feature-id="image-generation"');
  });

  it('keeps vision settings out of the plugin detail when its Feature contribution is absent', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        installedPlugin={{
          id: 'openai-vision-recognition',
          name: '视觉识别',
          icon: 'vision-recognition',
          installedAt: '2026-08-08T00:00:00.000Z',
          installationSource: 'marketplace',
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
      />,
    );

    expect(html).toContain('analyze_image');
    expect(html).toContain('使用已配置视觉模型分析当前会话中的图片附件。');
    expect(html).not.toContain('data-feature-id="vision-recognition"');
  });

  it('hides built-in settings for local bundles that reuse reserved plugin ids', () => {
    const imageHtml = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        installedPlugin={{
          id: 'openai-image-generation',
          name: 'Local Image Bundle',
          installedAt: '2026-08-09T00:00:00.000Z',
          installationSource: 'local',
          skills: [],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );
    const visionHtml = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        installedPlugin={{
          id: 'openai-vision-recognition',
          name: 'Local Vision Bundle',
          installedAt: '2026-08-09T00:00:00.000Z',
          installationSource: 'local',
          skills: [],
          mcpServers: [],
          hooks: [],
          hookCount: 0,
          resources: [],
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );

    expect(imageHtml).not.toContain('desktop-image-generation-settings');
    expect(visionHtml).not.toContain('data-feature-id="vision-recognition"');
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
