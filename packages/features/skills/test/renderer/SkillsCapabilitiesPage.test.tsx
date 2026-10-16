// @vitest-environment happy-dom

import type { RuntimeSkillDetail } from '@setsuna-desktop/contracts';
import type { CapabilitiesRefreshCoordinator } from '@setsuna-desktop/renderer-contracts/capabilities';
import type { CapabilitiesPageNavigation, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Button, IconButton, TextArea, TextField } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SkillsRendererService } from '../../src/contracts/index.js';
import { SkillsCapabilitiesPage } from '../../src/renderer/SkillsCapabilitiesPage.js';

afterEach(cleanup);

const skillUi: SettingsViewUi = {
  Button, IconButton, TextArea, TextField, SkillIcon: () => null,
  PageHeader: ({ title, actions }) => <header><h2>{title}</h2>{actions}</header>,
  ActionMenu: ({ items, onSelect }) => <>{items.map((item) => <Button key={item.id} disabled={item.disabled} onClick={() => onSelect(item.id)}>{item.label}</Button>)}</>,
  MarkdownDocument: ({ content }) => <div>{content}</div>,
  Toast: ({ message }) => <div role="alert">{message}</div>,
} as SettingsViewUi;

const host = { platform: 'darwin', revealFile: vi.fn(async () => undefined) };

function skill(id: string): RuntimeSkillDetail {
  return { id, name: id, kind: 'user', enabled: true, content: `# ${id}`, sourceContent: `# ${id}`, references: [] };
}

it.each(['darwin', 'win32'])('reveals the loaded Skill document on %s and reports native failures', async (platform) => {
  const sourceContent = '---\nname: Document\nmetadata:\n  version: "01"\n---\n\n# Instructions\n';
  const summary = { ...skill('Document'), path: '/plugins/document/SKILL.md' };
  const detail = { ...summary, content: '# Instructions', sourceContent, path: '/plugin-skill-overrides/document/SKILL.md' };
  const snapshot = { skills: [summary], extraRoots: [] };
  let load!: (detail: RuntimeSkillDetail) => void;
  const service = {
    getSnapshot: () => snapshot, subscribe: () => () => undefined,
    getSkill: vi.fn(() => new Promise<RuntimeSkillDetail>((resolve) => { load = resolve; })),
  } as unknown as SkillsRendererService;
  const revealFile = vi.fn().mockRejectedValueOnce(new Error('Skill file no longer exists')).mockResolvedValue(undefined);
  render(<SkillsCapabilitiesPage sectionId="skills" service={service} host={{ platform, revealFile }} translate={(key) => key} ui={skillUi}
    capabilitiesRefresh={{ refresh: vi.fn() } as unknown as CapabilitiesRefreshCoordinator} />);
  fireEvent.click(screen.getByRole('button', { name: /^Document/u }));
  const reveal = screen.getByRole('button', { name: platform === 'darwin' ? 'feature.skills.revealInFinder' : 'feature.skills.revealInExplorer' });
  fireEvent.click(reveal);
  expect(revealFile).not.toHaveBeenCalled();
  await act(async () => load(detail));

  fireEvent.click(reveal);
  await screen.findByRole('alert');
  expect(revealFile).toHaveBeenCalledExactlyOnceWith(detail.path);
  expect(screen.getByRole('alert').textContent).toBe('Skill file no longer exists');
  fireEvent.click(reveal);
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(revealFile).toHaveBeenCalledTimes(2);
  expect(revealFile).toHaveBeenLastCalledWith(detail.path);

  fireEvent.click(screen.getByRole('button', { name: 'feature.skills.edit' }));
  expect((screen.getByRole('textbox', { name: 'feature.skills.editor.content' }) as HTMLTextAreaElement).value).toBe(detail.content);
});

it('keeps a failed Skill draft editable and prevents duplicate saves before retry', async () => {
  const snapshot = { skills: [skill('existing')], extraRoots: [] };
  let rejectSave!: (error: Error) => void;
  const createSkill = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }))
    .mockResolvedValueOnce({ ...skill('new'), name: 'New skill', content: '# Draft', sourceContent: '# Draft' });
  const service = { getSnapshot: () => snapshot, subscribe: () => () => undefined, createSkill } as unknown as SkillsRendererService;
  render(<SkillsCapabilitiesPage sectionId="skills" service={service} host={host} translate={(key) => key} ui={skillUi}
    capabilitiesRefresh={{ refresh: vi.fn() } as unknown as CapabilitiesRefreshCoordinator} />);
  fireEvent.click(screen.getByRole('button', { name: 'feature.skills.add' }));
  const name = screen.getByRole('textbox', { name: 'feature.skills.editor.name' }) as HTMLInputElement;
  const content = screen.getByRole('textbox', { name: 'feature.skills.editor.content' }) as HTMLTextAreaElement;
  fireEvent.change(name, { target: { value: 'New skill' } });
  fireEvent.change(content, { target: { value: '# Draft' } });
  const save = screen.getByRole('button', { name: 'feature.skills.save' });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(createSkill).toHaveBeenCalledOnce();
  expect(content.disabled).toBe(true);
  await act(async () => rejectSave(new Error('Disk full')));
  expect(screen.getByRole('alert').textContent).toBe('Disk full');
  expect(name.value).toBe('New skill');
  expect(content.value).toBe('# Draft');
  expect(content.disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'feature.skills.save' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'feature.skills.editor.content' })).toBeNull());
  expect(createSkill).toHaveBeenCalledTimes(2);
  expect(screen.getByText('# Draft')).toBeTruthy();
});

it('keeps the selected Skill when dependency installation finishes after navigation', async () => {
  const first = { ...skill('First'), mcpDependencies: [{ type: 'mcp' as const, value: 'github', status: 'missing' as const }] };
  const second = skill('Second');
  const snapshot = { skills: [first, second], extraRoots: [] };
  let finish!: (result: { skill: RuntimeSkillDetail }) => void;
  const service = {
    getSnapshot: () => snapshot, subscribe: () => () => undefined,
    getSkill: vi.fn(async (id) => id === first.id ? first : second),
    installMcpDependencies: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
  } as unknown as SkillsRendererService;
  const capabilities = {
    renderBreadcrumb: ({ onBack }) => <Button onClick={onBack}>Back</Button>,
    renderCreateMenu: () => null,
  } as CapabilitiesPageNavigation;
  render(<SkillsCapabilitiesPage sectionId="skills" service={service} host={host} translate={(key) => key} ui={skillUi} capabilities={capabilities}
    capabilitiesRefresh={{ refresh: vi.fn(async () => undefined) } as unknown as CapabilitiesRefreshCoordinator} />);
  fireEvent.click(screen.getByRole('button', { name: /^First/u }));
  fireEvent.click(await screen.findByRole('button', { name: 'feature.skills.installAndEnable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: /^Second/u }));
  await screen.findByText('# Second');
  await act(async () => finish({ skill: { ...first, content: '# First updated', sourceContent: '# First updated' } }));
  expect(screen.getByRole('heading', { name: 'Second' })).toBeTruthy();
  expect(screen.getByText('# Second')).toBeTruthy();
  expect(screen.queryByText('# First updated')).toBeNull();
});

it('opens the dependency MCP authorization page without starting a hidden Skill login', async () => {
  const skill: RuntimeSkillDetail = {
    id: 'github-review', name: 'Review pull requests', kind: 'user', enabled: true,
    content: '# Review pull requests', sourceContent: '# Review pull requests', references: [],
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
    host={host}
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
