// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatComposerSession, type ChatComposerTargetIdentity } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';
import { useDesktopWorkspacePanelSession, desktopWorkspaceBrowserPanelInstances } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanelSession.js';
import { addPanelToSlotState, createBrowserPanel, createFilePanel } from '../../../../../src/features/workspace/model.js';
import { readSessionRecord, writeSessionRecord } from '../../../../../src/shared/preferences/sessionStorage.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  vi.useRealTimers();
});

const client = { uploadAttachment: vi.fn(), deleteAttachment: vi.fn(), linkAttachment: vi.fn() };
const scope = 'primary:0';
function useSession(target: ChatComposerTargetIdentity, windowKey: string | null = scope) {
  return {
    composer: useChatComposerSession(target, client, windowKey),
    panels: useDesktopWorkspacePanelSession(target, windowKey),
  };
}

it('recovers text, Skill references, files and browsers on demand after a window restart', () => {
  vi.useFakeTimers();
  const first = renderHook(({ target }) => useSession(target), { initialProps: { target: 'thread:A' as ChatComposerTargetIdentity } });
  const skillReferences = [{ skillId: 'skill-1', start: 2, end: 7 }];
  act(() => {
    first.result.current.composer.setDraft('  Skill 未发送\n下一行', skillReferences);
    first.result.current.panels.setSidePanelSlot((slot) => addPanelToSlotState(slot, createBrowserPanel('tab-A', 'https://example.com/a')));
    first.result.current.panels.setSidePanelExpanded(true);
  });
  first.rerender({ target: 'thread:B' });
  act(() => {
    first.result.current.composer.setDraft('B draft');
    first.result.current.panels.setBottomPanelSlot((slot) => addPanelToSlotState(slot, createFilePanel('src/main.ts', 'worktree-root')));
    first.result.current.panels.setBottomPanelExpanded(true);
  });
  // Closing before the debounce expires still flushes the latest input.
  first.unmount();
  const reads = vi.spyOn(window.localStorage, 'getItem');
  const restarted = renderHook(({ target }) => useSession(target), { initialProps: { target: 'thread:B' as ChatComposerTargetIdentity } });
  expect(restarted.result.current.composer.draft).toBe('B draft');
  expect(restarted.result.current.panels.bottomPanelSlot.panels).toEqual([createFilePanel('src/main.ts', 'worktree-root')]);
  expect(restarted.result.current.panels.bottomPanelExpanded).toBe(true);
  expect(Object.keys(restarted.result.current.panels.layouts)).toEqual(['thread:B']);
  expect(desktopWorkspaceBrowserPanelInstances(restarted.result.current.panels.layouts, 'thread:B', { sideVisible: true, bottomVisible: true })).toEqual([]);
  expect(reads.mock.calls.some(([key]) => key.endsWith('thread%3AA'))).toBe(false);
  restarted.rerender({ target: 'thread:A' });
  expect(restarted.result.current.composer.draft).toBe('  Skill 未发送\n下一行');
  expect(restarted.result.current.composer.draftSkillReferences).toEqual(skillReferences);
  expect(restarted.result.current.panels.sidePanelSlot.panels[0]).toMatchObject({ id: 'tab-A', browser: { url: 'https://example.com/a' } });
  expect(restarted.result.current.composer.attachmentStore.getSnapshot().items).toEqual([]);
});

it('moves recovery ownership on first send and never resurrects a cleared or reset draft', () => {
  vi.useFakeTimers();
  const view = renderHook(({ target }) => useSession(target), { initialProps: { target: 'new-thread-slot:global' as ChatComposerTargetIdentity } });
  act(() => {
    view.result.current.composer.setDraft('first message');
    view.result.current.panels.setSidePanelSlot((slot) => addPanelToSlotState(slot, createBrowserPanel('tab-new')));
    view.result.current.composer.claimForThread('created');
    view.result.current.panels.claimForThread('created');
  });
  const sendingSession = view.result.current.composer;
  view.rerender({ target: 'thread:created' });
  act(() => window.dispatchEvent(new Event('beforeunload')));
  expect(readSessionRecord(scope, 'draft', 'new-thread-slot:global')).toBeNull();
  expect(readSessionRecord(scope, 'panels', 'new-thread-slot:global')).toBeNull();
  expect(readSessionRecord(scope, 'draft', 'thread:created')).toMatchObject({ draft: 'first message' });
  act(() => sendingSession.setDraft(''));
  expect(readSessionRecord(scope, 'draft', 'thread:created')).toBeNull();
  act(() => { view.result.current.composer.setDraft('next input'); });
  const staleSession = view.result.current.composer;
  act(() => view.result.current.composer.reset());
  act(() => staleSession.setDraft('late failed request'));
  view.unmount();
  act(() => vi.runAllTimers());
  const restarted = renderHook(() => useSession('thread:created'));
  expect(restarted.result.current.composer.draft).toBe('');
  expect(restarted.result.current.panels.sidePanelSlot.panels[0]?.id).toBe('tab-new');
});

it('keeps two windows on the same conversation independent, including sends and panel resets', () => {
  const first = renderHook(() => useSession('thread:A', 'primary:0'));
  const second = renderHook(() => useSession('thread:A', 'thread:A:0'));
  act(() => {
    first.result.current.composer.setDraft('primary draft');
    second.result.current.composer.setDraft('other window draft');
    second.result.current.panels.setSidePanelSlot((slot) => addPanelToSlotState(slot, createBrowserPanel('second-window-tab')));
  });
  act(() => {
    first.result.current.composer.setDraft('');
    first.result.current.panels.resetForIdentity('thread:A');
  });
  first.unmount();
  second.unmount();
  const restarted = renderHook(() => useSession('thread:A', 'thread:A:0'));
  expect(restarted.result.current.composer.draft).toBe('other window draft');
  expect(restarted.result.current.panels.sidePanelSlot.panels[0]?.id).toBe('second-window-tab');
});

it('loads after bootstrap without reading dormant sessions, and tolerates invalid or unavailable storage', () => {
  writeSessionRecord(scope, 'draft', 'thread:A', {
    draft: 'saved', skillReferences: [{ skillId: 'invalid', start: 0, end: 99 }],
    workspaceReferences: [{ start: 0, end: 5, entry: { kind: 'file', path: 'other.txt', name: 'other.txt', parent: '' } }],
  });
  for (let index = 0; index < 500; index++) writeSessionRecord(scope, 'panels', `thread:dormant-${index}`, { sidePanelSlot: { panels: [createBrowserPanel(`tab-${index}`)] } });
  const reads = vi.spyOn(window.localStorage, 'getItem');
  const view = renderHook(({ key }) => useSession('thread:A', key), { initialProps: { key: null as string | null } });
  expect(reads).not.toHaveBeenCalled();
  view.rerender({ key: scope });
  expect(view.result.current.composer.draft).toBe('saved');
  expect(view.result.current.composer.draftSkillReferences).toEqual([]);
  expect(view.result.current.composer.draftWorkspaceReferences).toEqual([]);
  expect(reads).toHaveBeenCalledTimes(2);
  expect(Object.keys(view.result.current.panels.layouts)).toEqual(['thread:A']);
  view.unmount();
  reads.mockImplementation(() => { throw new Error('Storage unavailable'); });
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  const unavailable = renderHook(() => useSession('thread:B'));
  act(() => unavailable.result.current.composer.setDraft('still editable'));
  expect(unavailable.result.current.composer.draft).toBe('still editable');
  expect(() => unavailable.unmount()).not.toThrow();
});

it('clears persisted state for a deleted conversation even when it has not been visited', () => {
  writeSessionRecord(scope, 'draft', 'thread:deleted', { draft: 'old', skillReferences: [] });
  writeSessionRecord(scope, 'panels', 'thread:deleted', { sidePanelSlot: { panels: [createBrowserPanel('old-tab')] } });
  const view = renderHook(({ target }) => useSession(target), { initialProps: { target: 'thread:A' as ChatComposerTargetIdentity } });
  act(() => {
    view.result.current.composer.discardThread('deleted');
    view.result.current.panels.resetForIdentity('thread:deleted');
  });
  view.rerender({ target: 'thread:deleted' });
  expect(view.result.current.composer.draft).toBe('');
  expect(view.result.current.panels.sidePanelSlot.panels).toEqual([]);
});
