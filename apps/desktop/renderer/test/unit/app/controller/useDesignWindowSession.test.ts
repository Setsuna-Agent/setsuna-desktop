// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesignWindowSession } from '../../../../src/app/controller/useDesignWindowSession.js';
import type { MainView } from '../../../../src/app/types.js';
import { writeSessionRecord } from '../../../../src/shared/preferences/sessionStorage.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

it('restores the active draft in the same window after switching away and reopening', () => {
  vi.stubGlobal('setsunaDesktop', { desktop: { platform: 'darwin' } });
  const view = renderHook(({ destination }: { destination?: MainView }) => useDesignWindowSession('primary:0', destination, false),
    { initialProps: {} });
  expect(view.result.current.designLocation).toBeNull();
  view.rerender({ destination: 'design' });
  const draft = { projectId: 'site', rootId: 'web', path: 'screens\\old/CON.design.json', homeFilter: { projectId: 'site' }, projectCanvas: true } as const;
  act(() => view.result.current.setDesignLocation(draft));
  view.rerender({ destination: 'chat' });
  view.rerender({ destination: 'design' });
  expect(view.result.current.designLocation).toEqual(draft);
  view.unmount();

  const reopened = renderHook(() => useDesignWindowSession('primary:0', undefined, false));
  expect(reopened.result.current).toMatchObject({ activeView: 'design', designLocation: draft });
  const anotherWindow = renderHook(() => useDesignWindowSession('primary:1', undefined, false));
  expect(anotherWindow.result.current).toMatchObject({ activeView: 'chat', designLocation: null });
});

it('restores a Windows relative path and falls back to the filter for rooted or traversing paths', () => {
  vi.stubGlobal('setsunaDesktop', { desktop: { platform: 'win32' } });
  const scope = { projectId: 'site' };
  function reopen(path: string) {
    writeSessionRecord('primary:0', 'selection', 'design', { active: true, location: { ...scope, path, homeFilter: scope } });
    const view = renderHook(() => useDesignWindowSession('primary:0', undefined, false));
    const location = view.result.current.designLocation;
    view.unmount();
    return location;
  }
  expect(reopen('drafts\\home.design.json')?.path).toBe('drafts/home.design.json');
  expect(reopen('C:\\home.design.json')).toEqual(scope);
  expect(reopen('drafts\\..\\..\\home.design.json')).toEqual(scope);
});

it.each([
  { kind: 'design filter', location: { projectId: 'site', rootId: 'web' } },
  { kind: 'multi-project filter', location: { projectIds: ['site', 'mobile'] } },
  { kind: 'draft opened from multiple projects', location: { projectId: 'site', rootId: 'web', path: 'draft.design.json',
    homeFilter: { projectIds: ['site', 'mobile'] } } },
  { kind: 'empty project canvas', location: { projectId: 'site', projectCanvas: true } as const },
])('keeps the $kind while giving an explicitly opened conversation priority', ({ location }) => {
  const view = renderHook(() => useDesignWindowSession('thread:sample:0', 'design', false));
  act(() => view.result.current.setDesignLocation(location));
  view.unmount();

  const thread = renderHook(() => useDesignWindowSession('thread:sample:0', undefined, true));
  expect(thread.result.current).toMatchObject({ activeView: 'chat', designLocation: location });
  thread.unmount();

  const reopened = renderHook(() => useDesignWindowSession('thread:sample:0', undefined, false));
  expect(reopened.result.current).toMatchObject({ activeView: 'chat', designLocation: location });
});
