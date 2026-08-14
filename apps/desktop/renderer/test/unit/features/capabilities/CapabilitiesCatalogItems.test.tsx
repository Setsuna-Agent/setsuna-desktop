// @vitest-environment happy-dom

import type {
  RuntimeMcpServer,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CapabilitiesMcpListItem,
  CapabilitiesSkillListItem,
} from '../../../../src/features/capabilities/CapabilitiesCatalogItems.js';
import { CapabilitiesSkillCatalog } from '../../../../src/features/capabilities/CapabilitiesSkillCatalog.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('capability catalog list items', () => {
  it('keeps MCP controls in the shared borderless list item', async () => {
    const onOpen = vi.fn();
    const onUpdate = vi.fn();
    renderWithI18n(
      <CapabilitiesMcpListItem
        server={mcpServer}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );

    expect(document.querySelector('.desktop-capability-list-item')).toBeTruthy();
    expect(document.querySelector('.desktop-capability-card')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Docs MCP' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '启用' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith({ enabled: false });
  });

  it('keeps Skill navigation and enable controls in the shared list item', async () => {
    const onOpen = vi.fn();
    const onUpdate = vi.fn();
    renderWithI18n(
      <CapabilitiesSkillListItem
        skill={skill}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Docs Skill' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '启用' }));
    expect(document.querySelector('[data-skill-icon="skill"]')).toBeTruthy();
    expect(document.querySelector('.desktop-capability-list-item__actions')).toBeNull();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith({ enabled: false });
  });

  it('uses the owning Plugin icon for Plugin Skills', () => {
    renderWithI18n(
      <CapabilitiesSkillListItem
        skill={{
          ...skill,
          id: 'documents.documents',
          icon: 'documents',
          kind: 'plugin',
          pluginId: 'documents',
        }}
        onOpen={() => undefined}
        onUpdate={() => undefined}
      />,
    );

    expect(document.querySelector('[data-plugin-icon="documents"]')).toBeTruthy();
    expect(document.querySelector('[data-skill-icon="skill"]')).toBeNull();
  });

  it('groups Skills by built-in, Plugin, and personal ownership', () => {
    renderWithI18n(
      <CapabilitiesSkillCatalog
        skills={[
          { ...skill, id: 'personal', name: 'Personal', kind: 'user' },
          { ...skill, id: 'plugin', name: 'Plugin', kind: 'plugin', pluginId: 'docs' },
          { ...skill, id: 'builtin', name: 'Built-in', kind: 'builtin' },
        ]}
        onOpen={() => undefined}
        onUpdate={() => undefined}
      />,
    );

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      '个人 Skill',
      '插件提供的 Skill',
      '内置 Skill',
    ]);
  });

});

function renderWithI18n(content: ReactNode) {
  return render(<I18nProvider initialLocale="zh-CN">{content}</I18nProvider>);
}

const mcpServer: RuntimeMcpServer = {
  key: 'docs',
  label: 'Docs MCP',
  description: 'Search documentation.',
  transport: 'streamableHttp',
  args: [],
  url: 'https://example.com/mcp',
  timeoutMs: 30_000,
  startupTimeoutMs: 30_000,
  toolTimeoutMs: 30_000,
  enabled: true,
  allowedTools: [],
  disabledTools: [],
  authStatus: 'notLoggedIn',
  tools: [],
  envKeys: [],
  headerKeys: [],
  source: 'local',
  readOnly: false,
};

const skill: RuntimeSkillSummary = {
  id: 'docs-skill',
  name: 'Docs Skill',
  description: 'Search project documentation.',
  kind: 'user',
  enabled: true,
  mcpDependencies: [],
};
