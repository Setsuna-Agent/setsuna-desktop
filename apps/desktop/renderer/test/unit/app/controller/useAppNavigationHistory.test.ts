// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppNavigationHistory, type AppNavigationLocation } from '../../../../src/app/controller/useAppNavigationHistory.js';

afterEach(cleanup);

const draft: AppNavigationLocation = { view: 'chat', threadId: null, projectId: 'project-a' };
const threadA: AppNavigationLocation = { view: 'chat', threadId: 'thread-a', projectId: 'project-a' };
const threadB: AppNavigationLocation = { view: 'chat', threadId: 'thread-b', projectId: null };
const settings: AppNavigationLocation = { view: 'settings' };
const plugin: AppNavigationLocation = { view: 'plugin', viewKey: 'plugin.example.page' };

function setup(initialLocation = draft) {
  const onError = vi.fn();
  let commit!: (location: AppNavigationLocation) => void;
  const onNavigate = vi.fn(async (location: AppNavigationLocation): Promise<unknown> => { commit(location); return undefined; });
  const hook = renderHook(() => {
    const [location, setLocation] = useState(initialLocation);
    commit = setLocation;
    const history = useAppNavigationHistory({ location, onNavigate, onError });
    return { ...history, location, visit: setLocation };
  });
  return { ...hook, onNavigate, onError, commit: (location: AppNavigationLocation) => commit(location) };
}

describe('app navigation history', () => {
  it('returns through pages, conversations and the original project draft, then restores forward destinations', async () => {
    const { result, onNavigate } = setup();
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
    for (const location of [threadA, settings, plugin]) act(() => result.current.visit(location));

    for (const location of [settings, threadA, draft]) {
      await act(async () => result.current.goBack());
      expect(result.current.location).toEqual(location);
      expect(onNavigate).toHaveBeenLastCalledWith(location);
    }
    expect(result.current.canGoBack).toBe(false);
    for (const location of [threadA, settings, plugin]) {
      await act(async () => result.current.goForward());
      expect(result.current.location).toEqual(location);
    }
    expect(result.current.canGoForward).toBe(false);
  });

  it('discards the forward branch after an outside selection without recording duplicate destinations', async () => {
    const { result } = setup(threadA);
    act(() => result.current.visit(settings));
    await act(async () => result.current.goBack());
    expect(result.current.canGoForward).toBe(true);
    act(() => result.current.visit(threadB));
    act(() => result.current.visit({ ...threadB }));
    expect(result.current.canGoForward).toBe(false);
    await act(async () => result.current.goBack());
    expect(result.current.location).toEqual(threadA);
    expect(result.current.canGoBack).toBe(false);
  });

  it.each(['cancelled', 'failed'] as const)('preserves the history cursor when returning is %s', async (outcome) => {
    const { result, onNavigate, onError } = setup(threadA);
    act(() => result.current.visit(settings));
    const error = new Error('Conversation could not be loaded');
    if (outcome === 'cancelled') onNavigate.mockResolvedValueOnce(false);
    else onNavigate.mockRejectedValueOnce(error);
    await act(async () => result.current.goBack());
    expect(result.current.location).toEqual(settings);
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
    if (outcome === 'failed') expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    else expect(onError).not.toHaveBeenCalled();
    await act(async () => result.current.goBack());
    expect(result.current.location).toEqual(threadA);
    expect(result.current.canGoForward).toBe(true);
  });

  it('blocks overlapping arrow requests until an asynchronous destination commits', async () => {
    const { result, onNavigate, commit } = setup(threadA);
    act(() => result.current.visit(settings));
    let finish!: () => void;
    onNavigate.mockImplementationOnce((location) => new Promise<void>((resolve) => {
      finish = () => { commit(location); resolve(); };
    }));
    await act(async () => { result.current.goBack(); result.current.goBack(); });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(result.current.location).toEqual(settings);
    expect(result.current.canGoBack).toBe(false);
    await act(async () => finish());
    expect(result.current.location).toEqual(threadA);
    expect(result.current.canGoForward).toBe(true);
  });

  it('keeps a newer page visit when an older guarded navigation finishes without committing', async () => {
    const { result, onNavigate } = setup(threadA);
    act(() => result.current.visit(settings));
    let finish!: () => void;
    onNavigate.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await act(async () => result.current.goBack());
    act(() => result.current.visit(plugin));
    await act(async () => finish());
    expect(result.current.location).toEqual(plugin);
    await act(async () => result.current.goBack());
    expect(result.current.location).toEqual(settings);
  });
});
