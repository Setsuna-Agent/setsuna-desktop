// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTerminalActions } from '../../../src/renderer/actions/useTerminalActions.js';
import { useTerminalActionEditor } from '../../../src/renderer/actions/useTerminalActionEditor.js';
import { terminalActionsStorageKey } from '../../../src/renderer/actions/storage.js';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@setsuna-desktop/renderer-ui', () => ({ useToast: () => toast }));
const translate = (key: string) => key;

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); toast.error.mockClear(); });

it('shares project actions and the selected action across panels and restores configured options', () => {
  const first = renderHook(() => useTerminalActions('project-a', translate));
  const second = renderHook(() => useTerminalActions('project-a', translate));
  const other = renderHook(() => useTerminalActions('project-b', translate));
  const script = 'export NAME="a quoted value"\npnpm dev';
  act(() => { first.result.current.add({ name: 'Server', command: script, icon: 'play', platform: 'darwin' }); });
  const action = first.result.current.actions[0]!;
  expect(second.result.current.selected).toEqual(action);
  expect(other.result.current.actions).toEqual([]);
  act(() => { second.result.current.add({ name: 'Check', command: 'pnpm test', icon: 'flask' }); });
  const check = second.result.current.actions[1]!;
  act(() => { second.result.current.select(check.id); });
  first.unmount();
  const restored = renderHook(() => useTerminalActions('project-a', translate));
  expect(restored.result.current.selected).toEqual(check);
  expect(restored.result.current.actions[0]).toMatchObject({ command: script, icon: 'play', platform: 'darwin' });
  act(() => { restored.result.current.replace([action], restored.result.current.actions); });
  expect(second.result.current.selected?.id).toBe(action.id);
});

it('keeps failed writes open and commits one action without changing its identity or selection', () => {
  const source = renderHook(() => useTerminalActions('project', translate));
  act(() => { source.result.current.add({ name: 'Start', command: 'pnpm dev' }); });
  const saved = source.result.current.actions[0]!;
  const editor = renderHook(() => useTerminalActionEditor(source.result.current.actions, source.result.current.replace));
  act(() => { editor.result.current.open(saved); });
  const changed = { ...saved, name: 'Test', command: 'pnpm test', icon: 'flask', platform: 'win32' } as const;
  expect(source.result.current.selected).toEqual(saved);
  const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Full'); });
  act(() => { expect(editor.result.current.save(changed)).toBe(false); });
  expect(editor.result.current.editing?.action.id).toBe(saved.id);
  expect(source.result.current.selected).toEqual(saved);
  write.mockRestore();
  act(() => { expect(editor.result.current.save(changed)).toBe(true); });
  expect(source.result.current.selected).toEqual(changed);
  expect(editor.result.current.editing).toBeNull();
  editor.rerender();
  act(() => { editor.result.current.open(changed); });
  act(() => { expect(editor.result.current.remove()).toBe(true); });
  expect(source.result.current.selected).toBeNull();
});

it('rejects saving or deleting from a stale editor instead of losing changes from another panel', () => {
  const source = renderHook(() => useTerminalActions('project', translate));
  act(() => { source.result.current.add({ name: 'Start', command: 'pnpm dev' }); });
  const saved = source.result.current.actions[0]!;
  const editor = renderHook(() => useTerminalActionEditor(source.result.current.actions, source.result.current.replace));
  act(() => { editor.result.current.open(saved); });
  act(() => { source.result.current.add({ name: 'Test', command: 'pnpm test' }); });
  act(() => { expect(editor.result.current.save({ ...saved, command: 'pnpm start' })).toBe(false); });
  act(() => { expect(editor.result.current.remove()).toBe(false); });
  expect(source.result.current.actions.map((action) => action.name)).toEqual(['Start', 'Test']);
  expect(editor.result.current.editing?.action).toEqual(saved);
  expect(toast.error).toHaveBeenCalledWith('feature.terminal.actions.changedElsewhere');
});

it('does not overwrite malformed data and accepts older actions without icon or platform fields', () => {
  const key = terminalActionsStorageKey('project');
  localStorage.setItem(key, '{broken');
  const view = renderHook(() => useTerminalActions('project', translate));
  expect(view.result.current.ready).toBe(false);
  act(() => { expect(view.result.current.add({ name: 'New', command: 'echo new' })).toBe(false); });
  expect(localStorage.getItem(key)).toBe('{broken');
  const action = { id: 'from-other-window', name: 'Shared', command: 'echo shared' };
  localStorage.setItem(key, JSON.stringify({ actions: [action], selectedId: action.id }));
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key })); });
  expect(view.result.current.selected).toEqual({ ...action, icon: 'settings', platform: 'all' });
});
