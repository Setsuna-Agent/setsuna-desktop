// @vitest-environment happy-dom

import type { RuntimePluginMarketplaceItem, RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilitiesPluginDetail } from '../../../../src/features/capabilities/CapabilitiesPluginDetail.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('CapabilitiesPluginDetail actions', () => {
  it('groups installed plugin actions and starts a chat with its first enabled Skill', async () => {
    const onInstall = vi.fn(async () => undefined);
    const onRemove = vi.fn(async () => undefined);
    const onUseInConversation = vi.fn();
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="zh-CN">
        <CapabilitiesPluginDetail
          error={null}
          installedPlugin={installedPlugin}
          installing={false}
          marketplacePlugin={marketplacePlugin}
          removing={false}
          runtimeSkills={[{
            id: 'docs-plugin.read-docs',
            name: 'Read Docs',
            kind: 'plugin',
            pluginId: 'docs-plugin',
            enabled: true,
          }]}
          onBack={() => undefined}
          onInstall={onInstall}
          onRemove={onRemove}
          onUseInConversation={onUseInConversation}
        />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(await screen.findByRole('menuitem', { name: '更新到 v2.0.0' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '卸载' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: '在对话中使用' }));
    expect(onUseInConversation).toHaveBeenCalledWith('docs-plugin.read-docs');

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '更新到 v2.0.0' }));
    expect(onInstall).toHaveBeenCalledWith(marketplacePlugin);

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '卸载' }));
    expect(onRemove).toHaveBeenCalledWith(installedPlugin);
  });
});

const marketplacePlugin: RuntimePluginMarketplaceItem = {
  id: 'docs-plugin',
  name: 'Docs Plugin',
  version: '2.0.0',
  publisher: 'Setsuna',
  tags: [],
  featured: false,
  skills: [{ id: 'docs-plugin.read-docs', name: 'Read Docs' }],
  mcpServers: [],
  hooks: [],
  resources: [],
  capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
  installed: true,
  updateAvailable: true,
};

const installedPlugin: RuntimePluginSummary = {
  id: 'docs-plugin',
  name: 'Docs Plugin',
  version: '1.0.0',
  installedAt: '2026-08-14T00:00:00.000Z',
  installationSource: 'marketplace',
  skills: [{ id: 'docs-plugin.read-docs', name: 'Read Docs' }],
  mcpServers: [],
  hooks: [],
  hookCount: 0,
  resources: [],
};
