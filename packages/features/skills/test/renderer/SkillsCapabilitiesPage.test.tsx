// @vitest-environment happy-dom

import type { RuntimeSkillDetail } from '@setsuna-desktop/contracts';
import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import type { CapabilitiesPageNavigation, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SkillsRendererService } from '../../src/contracts/index.js';
import { SkillsCapabilitiesPage } from '../../src/renderer/SkillsCapabilitiesPage.js';

afterEach(cleanup);

it('opens the dependency MCP authorization page without starting a hidden Skill login', async () => {
  const skill: RuntimeSkillDetail = {
    id: 'github-review', name: 'Review pull requests', kind: 'user', enabled: true,
    content: '# Review pull requests', references: [],
    mcpDependencies: [{
      type: 'mcp', value: 'github', transport: 'streamableHttp',
      url: 'https://api.githubcopilot.com/mcp/', status: 'authRequired', authStatus: 'notLoggedIn',
    }],
  };
  const snapshot = { extraRoots: [], skills: [skill] };
  const service = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    getSkill: vi.fn(async () => skill),
    authenticateMcpDependency: vi.fn(async () => skill),
  } as unknown as SkillsRendererService;
  const openSection = vi.fn();
  const capabilities: CapabilitiesPageNavigation = {
    activeItemId: null, catalogNavigation: null, catalogNavigationInPage: false, workspacePath: null,
    openChat: vi.fn(), openPluginChat: vi.fn(), openSection, setActiveItemId: vi.fn(),
    renderBreadcrumb: () => null, renderCreateMenu: () => null,
  };
  render(<SkillsCapabilitiesPage
    sectionId="skills"
    capabilities={capabilities}
    capabilitiesRefresh={{ refresh: vi.fn() } as unknown as CapabilitiesRefreshCoordinator}
    service={service}
    translate={(key) => key}
    ui={{
      Button, IconButton, SkillIcon: () => null, PageHeader: () => null, ActionMenu: () => null,
      MarkdownDocument: () => null,
    } as unknown as SettingsViewUi}
  />);

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Review pull requests/u }));
  });
  fireEvent.click(screen.getByRole('button', { name: 'feature.skills.login' }));

  expect(openSection).toHaveBeenCalledExactlyOnceWith('mcp', 'github');
  expect(service.authenticateMcpDependency).not.toHaveBeenCalled();
});
