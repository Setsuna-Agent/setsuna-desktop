// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { TerminalActions } from '../../../src/renderer/actions/TerminalActions.js';
import { TerminalActionsHostProvider } from '../../../src/renderer/actions/context.js';
import { TerminalActionSettingsPage } from '../../../src/renderer/actions/TerminalActionSettingsPage.js';
import { readTerminalActions, terminalActionsStorageKey } from '../../../src/renderer/actions/storage.js';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@setsuna-desktop/renderer-ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@setsuna-desktop/renderer-ui')>(), useToast: () => toast,
}));
const t: RendererTranslate = (key, params) => params?.name ? `${key}:${params.name}` : key;
const project = { id: 'project', name: 'Example' };
const settingsUi = {
  PageLayout: ({ parent, children }) => <section>
    {parent ? <button onClick={parent.onBack}>Back</button> : null}{children}
  </section>,
  Section: ({ children }) => <section>{children}</section>,
  Group: ({ children }) => <div>{children}</div>,
  NavigationRow: ({ label, onClick }) => <button onClick={onClick}>{label}</button>,
} satisfies Partial<SettingsViewUi>;

afterEach(async () => {
  cleanup(); localStorage.clear(); toast.error.mockClear();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
});

it('selects an action without executing it, runs the chosen action once, and excludes other platforms', async () => {
  const actions = [
    { id: 'windows', name: 'Windows', command: 'echo windows', icon: 'settings', platform: 'win32' },
    { id: 'start', name: 'Start', command: 'pnpm dev', icon: 'play', platform: 'all' },
    { id: 'test', name: 'Test', command: 'pnpm test', icon: 'flask', platform: 'darwin' },
  ];
  localStorage.setItem(terminalActionsStorageKey(project.id), JSON.stringify({ actions, selectedId: 'windows' }));
  let resolveRun!: () => void;
  const runAction = vi.fn(() => new Promise<void>((resolve) => { resolveRun = resolve; }));
  const user = userEvent.setup();
  render(<TerminalActionsHostProvider host={{ projects: [project], platform: 'darwin', runAction, openSettings: vi.fn() }}>
    <TerminalActions project={project} translate={t} />
  </TerminalActionsHostProvider>);
  // The saved Windows selection cannot execute on this host; use the available default.
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.run:Start' }));
  expect(runAction).toHaveBeenCalledWith(actions[1]);
  await act(async () => { resolveRun(); });
  runAction.mockClear();
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.title' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Test' }));
  expect(readTerminalActions(project.id).selectedId).toBe('test');
  expect(runAction).not.toHaveBeenCalled();
  await user.dblClick(screen.getByRole('button', { name: 'feature.terminal.actions.run:Test' }));
  expect(runAction).toHaveBeenCalledExactlyOnceWith(actions[2]);
  await act(async () => { resolveRun(); });
});

it('carries an unsaved quick action into environment settings and persists its selected icon, platform and script together', async () => {
  const user = userEvent.setup();
  const runAction = vi.fn(async () => {});
  function Harness() {
    const [settings, setSettings] = useState(false);
    return <TerminalActionsHostProvider host={{ projects: [project], platform: 'darwin', runAction,
      openSettings: () => setSettings(true) }}>
      {settings ? <TerminalActionSettingsPage sectionId="environments" translate={t} ui={settingsUi as SettingsViewUi} />
        : <TerminalActions project={project} translate={t} />}
    </TerminalActionsHostProvider>;
  }
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.title' }));
  await user.click(await screen.findByRole('menuitem', { name: 'feature.terminal.actions.add' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'feature.terminal.actions.name' }), { target: { value: 'Check' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'feature.terminal.actions.command' }), { target: { value: 'echo "check"\npnpm test' } });
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.chooseIcon' }));
  await user.click(await screen.findByRole('button', { name: 'feature.terminal.actions.icon.rocket' }));
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.environmentSettings' }));
  const script = await screen.findByRole('textbox', { name: 'feature.terminal.actions.script' });
  expect((script as HTMLTextAreaElement).value).toBe('echo "check"\npnpm test');
  expect(readTerminalActions(project.id).actions).toEqual([]);
  await user.click(screen.getByRole('radio', { name: 'feature.terminal.actions.platform.win32' }));
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.save' }));
  await waitFor(() => expect(readTerminalActions(project.id).actions).toEqual([
    expect.objectContaining({ name: 'Check', command: 'echo "check"\npnpm test', icon: 'rocket', platform: 'win32' }),
  ]));
  expect(runAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.delete' }));
  expect(readTerminalActions(project.id).actions).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.save' }));
  expect(readTerminalActions(project.id).selectedId).toBeNull();
});

it('starts an empty project with an unsaved action, discards it on return, and saves only completed fields', async () => {
  const user = userEvent.setup();
  render(<TerminalActionsHostProvider host={{ projects: [project], platform: 'darwin', openSettings: vi.fn() }}>
    <TerminalActionSettingsPage sectionId="environments" translate={t} ui={settingsUi as SettingsViewUi} />
  </TerminalActionsHostProvider>);

  await user.click(screen.getByRole('button', { name: project.name }));
  const name = await screen.findByRole<HTMLInputElement>('textbox', { name: 'feature.terminal.actions.name' });
  expect(name.value).toBe('');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'feature.terminal.actions.save' }).disabled).toBe(true);
  fireEvent.change(name, { target: { value: 'Unsaved' } });
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(localStorage.getItem(terminalActionsStorageKey(project.id))).toBeNull();

  await user.click(screen.getByRole('button', { name: project.name }));
  const freshName = await screen.findByRole<HTMLInputElement>('textbox', { name: 'feature.terminal.actions.name' });
  expect(freshName.value).toBe('');
  fireEvent.change(freshName, { target: { value: 'Start' } });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'feature.terminal.actions.save' }).disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'feature.terminal.actions.script' }), { target: { value: 'pnpm dev' } });
  expect(readTerminalActions(project.id).actions).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.save' }));
  const saved = readTerminalActions(project.id).actions;
  expect(saved).toEqual([expect.objectContaining({ name: 'Start', command: 'pnpm dev', icon: 'settings', platform: 'all' })]);

  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: project.name }));
  const savedName = await screen.findByRole<HTMLInputElement>('textbox', { name: 'feature.terminal.actions.name' });
  expect(savedName.value).toBe('Start');
  fireEvent.change(screen.getByRole('textbox', { name: 'feature.terminal.actions.script' }), { target: { value: 'pnpm start' } });
  await user.click(screen.getByRole('button', { name: 'feature.terminal.actions.save' }));
  expect(readTerminalActions(project.id).actions).toEqual([{ ...saved[0], command: 'pnpm start' }]);
});
