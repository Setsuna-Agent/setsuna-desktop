// @vitest-environment happy-dom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { PageSessionProvider } from '@setsuna-desktop/renderer-ui';
import { afterEach, expect, it, vi } from 'vitest';
import type { RuntimeConfigState, RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import { useComposerModelSelection } from '../../../../../src/features/chat/composer/preferences/useComposerModelSelection.js';
import { useChatComposerModeController } from '../../../../../src/features/chat/composer/useChatComposerModeController.js';
import { CHAT_THINKING_PREFERENCES_STORAGE_KEY } from '../../../../../src/features/chat/composer/chatThinkingPreferences.js';

afterEach(() => { cleanup(); localStorage.clear(); });
const model = (id: string) => ({ id, name: id, code: id, enabled: id === 'global', maxOutputTokens: 4096, thinkingEnabled: true, thinkingEfforts: ['low', 'high'], defaultThinkingEffort: 'low' });
const provider = { id: 'provider', provider: 'openai-responses' as const, name: 'Provider', enabled: true, apiKeySet: false, apiKeyPreview: '', baseUrl: 'https://example.test', models: [model('global'), model('project')] };
const config = { providers: [provider], activeProviderId: provider.id } as RuntimeConfigState;
const project: WorkspaceProject = { id: 'project', name: 'Project', createdAt: '', updatedAt: '', conversationDefaults: { model: { providerId: provider.id, modelId: 'project' } } };
it('applies project choices only to new conversations and lets explicit draft selection win without modifying global defaults', () => {
  const onSelectModel = vi.fn();
  const view = renderHook(({ thread }: { thread: RuntimeThread | null }) => useComposerModelSelection({ config, activeProject: project, currentThread: thread, onSelectModel }), { initialProps: { thread: null as RuntimeThread | null } });
  expect(view.result.current.turnModelSelection?.modelId).toBe('project');
  act(() => view.result.current.selectModel(provider.id, 'global'));
  expect(view.result.current.turnModelSelection?.modelId).toBe('global');
  expect(onSelectModel).not.toHaveBeenCalled();
  view.rerender({ thread: { id: 'existing', modelBinding: { providerId: provider.id, modelId: 'project', modelCode: 'project' } } as RuntimeThread });
  expect(view.result.current.selectedThreadModel.reference?.modelId).toBe('project');
  expect(view.result.current.turnModelSelection).toBeUndefined();
  act(() => view.result.current.selectModel(provider.id, 'global'));
  expect(onSelectModel).toHaveBeenCalledWith(provider.id, 'global', 'existing');
});
it('falls back when a stored default is unavailable and seeds thinking without rewriting the global preference', () => {
  const unavailable = { ...project, conversationDefaults: { model: { providerId: provider.id, modelId: 'removed' } } };
  const selection = renderHook(() => useComposerModelSelection({ config, activeProject: unavailable, currentThread: null, onSelectModel: vi.fn() }));
  expect(selection.result.current.turnModelSelection?.modelId).toBe('global');
  const defaults = { enabled: true, effort: 'high' };
  const thinking = renderHook(() => useChatComposerModeController({ model: provider.models[0], provider, defaultThinking: defaults }));
  expect(thinking.result.current.createSendOptions({ attachments: [], selectedSkillIds: [], selectedSkillReferences: [] })).toMatchObject({ thinking: true, thinkingEffort: 'high' });
  expect(localStorage.getItem(CHAT_THINKING_PREFERENCES_STORAGE_KEY)).toBeNull();
  act(() => thinking.result.current.setThinkingEffort('low'));
  expect(localStorage.getItem(CHAT_THINKING_PREFERENCES_STORAGE_KEY)).toContain('low');
});

it('retains an explicit draft model when its page unmounts and is reopened', () => {
  let current!: ReturnType<typeof useComposerModelSelection>;
  function Consumer() {
    current = useComposerModelSelection({ preferenceKey: 'draft-1', config, currentThread: null, activeProject: project, onSelectModel: vi.fn() });
    return null;
  }
  const view = render(<PageSessionProvider><Consumer /></PageSessionProvider>);
  act(() => current.selectModel(provider.id, 'global'));
  view.rerender(<PageSessionProvider><span /></PageSessionProvider>);
  view.rerender(<PageSessionProvider><Consumer /></PageSessionProvider>);
  expect(current.turnModelSelection?.modelId).toBe('global');
});

it('updates thinking defaults when a new draft claims a project using the same model, then preserves them after sending', () => {
  type Props = Pick<Parameters<typeof useChatComposerModeController>[0], 'currentThreadId' | 'defaultThinking'>;
  const view = renderHook((props: Props) => useChatComposerModeController({
    ...props, model: provider.models[0], provider,
  }), { initialProps: { currentThreadId: null } as Props });
  view.rerender({ currentThreadId: null, defaultThinking: { enabled: true, effort: 'high' } });
  expect(view.result.current.createSendOptions({ attachments: [], selectedSkillIds: [], selectedSkillReferences: [] }))
    .toMatchObject({ thinking: true, thinkingEffort: 'high' });
  view.rerender({ currentThreadId: null, defaultThinking: { enabled: false, effort: 'low' } });
  expect(view.result.current.thinkingEnabled).toBe(false);
  expect(view.result.current.thinkingEffort).toBe('low');
  view.rerender({ currentThreadId: null, defaultThinking: { enabled: true, effort: 'high' } });
  view.rerender({ currentThreadId: 'created-thread' });
  expect(view.result.current.createSendOptions({ attachments: [], selectedSkillIds: [], selectedSkillReferences: [] }))
    .toMatchObject({ thinking: true, thinkingEffort: 'high' });
});

it('keeps an explicit thinking choice when project defaults change on the same model', () => {
  const view = renderHook(({ effort }: { effort: string }) => useChatComposerModeController({
    model: provider.models[0], provider, defaultThinking: { enabled: true, effort },
  }), { initialProps: { effort: 'high' } });
  act(() => view.result.current.setThinkingEffort('low'));
  view.rerender({ effort: 'low' });
  view.rerender({ effort: 'high' });
  expect(view.result.current.thinkingEffort).toBe('low');
  expect(localStorage.getItem(CHAT_THINKING_PREFERENCES_STORAGE_KEY)).toContain('low');
});
