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
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('capability catalog list items', () => {
  it('keeps MCP controls in the shared borderless list item', async () => {
    const onEdit = vi.fn();
    const onUpdate = vi.fn();
    renderWithI18n(
      <CapabilitiesMcpListItem
        authPending={false}
        server={mcpServer}
        onDelete={() => undefined}
        onEdit={onEdit}
        onLogin={() => undefined}
        onLogout={() => undefined}
        onUpdate={onUpdate}
      />,
    );

    expect(document.querySelector('.desktop-capability-list-item')).toBeTruthy();
    expect(document.querySelector('.desktop-capability-card')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Docs MCP' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '启用' }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith({ enabled: false });
  });

  it('keeps Skill navigation and selection controls in the shared list item', async () => {
    const onOpen = vi.fn();
    const onUpdate = vi.fn();
    renderWithI18n(
      <CapabilitiesSkillListItem
        dependencyPending={false}
        skill={skill}
        onAuthenticateDependency={() => undefined}
        onEdit={() => undefined}
        onInstallDependencies={() => undefined}
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Docs Skill' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '默认使用' }));
    expect(document.querySelector('[data-skill-icon="skill"]')).toBeTruthy();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith({ selected: false });
  });

  it('uses the owning Plugin icon for Plugin Skills', () => {
    renderWithI18n(
      <CapabilitiesSkillListItem
        dependencyPending={false}
        skill={{
          ...skill,
          id: 'documents.documents',
          icon: 'documents',
          kind: 'plugin',
          pluginId: 'documents',
        }}
        onAuthenticateDependency={() => undefined}
        onEdit={() => undefined}
        onInstallDependencies={() => undefined}
        onOpen={() => undefined}
        onUpdate={() => undefined}
      />,
    );

    expect(document.querySelector('[data-plugin-icon="documents"]')).toBeTruthy();
    expect(document.querySelector('[data-skill-icon="skill"]')).toBeNull();
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
  required: false,
  requireApproval: 'auto',
  trustLevel: 'untrusted',
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
  selected: true,
  mcpDependencies: [],
};
