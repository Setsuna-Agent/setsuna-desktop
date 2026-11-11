// @vitest-environment happy-dom
import { StrictMode, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopRuntimeClient, RuntimeConfigState, RuntimeThread } from '@setsuna-desktop/contracts';
import type { AssistantsSnapshot } from '@setsuna-desktop/feature-assistants/contracts';
import type { AssistantsClient } from '@setsuna-desktop/feature-assistants/renderer';
import type { RendererOwnedSlotRenderer } from '@setsuna-desktop/feature-core/renderer';
import { createAssistantsStore } from '../../../../../../../packages/features/assistants/src/renderer/store.js';
import { useDesktopNavigation } from '../../../../src/app/controller/useDesktopNavigation.js';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { AppRouteContent, type AppRouteContentProps } from '../../../../src/app/layout/AppRouteContent.js';
import type { MainView } from '../../../../src/app/types.js';
import { AssistantsFeatureServiceBoundary } from '../../../../src/composition/assistants/AssistantsFeatureBoundary.js';
import { AssistantSidebarEntry } from '../../../../src/composition/assistants/AssistantSidebarEntry.js';
import { useAssistantConversationEntry } from '../../../../src/composition/assistants/useAssistantConversationEntry.js';
import { KeyboardShortcutsProvider } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';
import { ChatWorkspace } from '../../../../src/features/chat/ChatWorkspace.js';
import { RendererPluginTestHost } from '../../support/RendererPluginTestHost.js';
import { writeChatThinkingPreference } from '../../../../src/features/chat/composer/chatThinkingPreferences.js';
import { modelOptionKey } from '../../../../src/shared/ui/model-picker/modelOptions.js';

vi.mock('../../../../src/shared/i18n/I18nProvider.js', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'zh-CN' }) }));
vi.mock('../../../../src/app/layout/ChatRouteAdapter.js', () => ({
  ChatRouteAdapter: Conversation,
}));
vi.mock('../../../../src/composition/feature-ui/FeatureRouteTopbar.js', () => ({ FeatureRouteTopbar: () => null }));
vi.mock('../../../../src/composition/assistants/AssistantsHostUi.js', () => ({ AssistantAvatar: () => null, assistantsHostUi: {
  Avatar: () => null, AvatarField: () => null, ModelPicker: () => null, ProjectIcon: () => null,
} }));
afterEach(() => { cleanup(); localStorage.clear(); });

it.each([false, true])('快捷键尊重导航确认，助理聊天与项目任务共用侧栏入口（StrictMode：%s）', async (strict) => {
  const user = userEvent.setup();
  const at = '2026-10-01T00:00:00Z';
  const config = { activeProviderId: 'provider', providers: [{
    id: 'provider', name: 'Provider', provider: 'openai-responses', enabled: true, apiKeySet: true, apiKeyPreview: '', baseUrl: 'https://example.test',
    models: [{ id: 'model', name: 'DeepSeek Flash', code: 'model-code', enabled: true, maxOutputTokens: 4096,
      thinkingEnabled: true, thinkingEfforts: ['medium', 'high'], defaultThinkingEffort: 'medium' }],
  }] } as RuntimeConfigState;
  writeChatThinkingPreference(modelOptionKey('provider', 'model'), { enabled: true, effort: 'medium' });
  const thread = (id: string, projectId?: string): RuntimeThread => ({
    id, title: id, projectId, featureId: id === 'local' ? 'assistants' : undefined, archived: false, createdAt: at, updatedAt: at, messageCount: 2,
    modelBinding: { providerId: 'provider', modelId: 'model', modelCode: 'model-code' },
    ...(projectId ? { origin: { featureId: 'assistants', entityId: id } } : {}),
    messages: [
      { id: `question-${id}`, role: 'user', content: `提问 ${id}`, createdAt: at, turnId: `turn-${id}` },
      { id: `answer-${id}`, role: 'assistant', content: `结果 ${id}`, createdAt: at, turnId: `turn-${id}` },
    ], lastMessagePreview: '', lastSeq: 0,
  });
  const snapshot: AssistantsSnapshot = {
    assistants: [{ id: 'owner', name: '助理', personality: '', thinkingEffort: 'high', projectIds: ['project'], createdAt: at, updatedAt: at }],
    conversations: [
      { assistantId: 'owner', threadId: 'local', source: 'shared', title: '助理聊天', createdAt: at, updatedAt: at },
    ],
    tasks: ['first', 'second'].map((id) => ({
      id, title: `任务 ${id}`, assistantId: 'owner', origin: { threadId: 'local' }, projectId: 'project',
      workThreadId: id, workspaceKey: 'project', instructions: '', status: 'completed', requests: [],
      turnId: `turn-${id}`, createdAt: at, updatedAt: at,
      ...(id === 'first' ? { execution: { modelSelection: { providerId: 'provider', modelId: 'model' }, thinkingEffort: 'high' } } : {}),
    })),
    projects: [], reminders: [], models: [], peers: [], connectors: [],
  };
  const client: AssistantsClient = {
    snapshot: vi.fn(async () => snapshot), create: vi.fn(), update: vi.fn(async (id, draft) => ({ ...draft, id, createdAt: at, updatedAt: at })), delete: vi.fn(), openConversation: vi.fn(async () => ({ threadId: 'local' })),
    revealQqSecret: vi.fn(), setQqSecret: vi.fn(), updatePeer: vi.fn(),
    updateSidebarEntry: vi.fn(), deleteSidebarEntry: vi.fn(),
  };
  const service = { client, store: createAssistantsStore(client) };
  service.store.publish(snapshot);
  const getThread = vi.fn(async (id: string) => thread(id, id === 'local' ? undefined : 'project'));
  const sendTurn = vi.fn(async () => ({ turnId: 'sent' }));
  const runtimeClient = { getThread, sendTurn } as unknown as DesktopRuntimeClient;
  let finishRefresh!: (threads: []) => void;
  const refresh = new Promise<[]>((resolve) => { finishRefresh = resolve; });
  const reloadThreads = vi.fn(() => refresh);
  let finishDiscard!: (accepted: boolean) => void;
  const discard = new Promise<boolean>((resolve) => { finishDiscard = resolve; });
  const confirmDiscardProjectFile = vi.fn().mockReturnValueOnce(discard).mockResolvedValue(true);
  function App() {
    const [activeView, setActiveView] = useState<MainView>('settings');
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(null);
    const navigation = useDesktopNavigation({
      activeView, setActiveView, activeProjectId, setActiveProjectId, currentThread, setCurrentThread,
      client: runtimeClient, confirmDiscardProjectFile,
      projects: [], setProjects: vi.fn(), onError: vi.fn(), threadsByProjectId: new Map(), reloadThreads,
      resetNewThreadWorkspacePanels: vi.fn(), resetProjectWorkspaceState: vi.fn(), resetThreadWorkspacePanels: vi.fn(),
    });
    const entry = useAssistantConversationEntry({ service, onError: vi.fn(),
      onOpenConversation: (destination) => navigation.selectThreadInView(destination, 'chat') });
    useAppKeyboardShortcuts({ 'app.openAssistant': { enabled: entry.available && !entry.opening, execute: () => void entry.open() } });
    return <AssistantsFeatureServiceBoundary service={service}>
      {activeView === 'chat' ? <><AssistantSidebarEntry activeThreadId={currentThread?.id} entry={entry} />
      <AppRouteContent {...{
        activeView, runtime: { currentThread, reloadThreads, client: runtimeClient, config, threads: [], archivedThreads: [] }, onSelectConversation: navigation.selectThreadInView,
        conversationOverviewVisibility: currentThread?.featureId === 'assistants' ? 'shown' : 'auto',
      } as unknown as AppRouteContentProps} /></> : null}
    </AssistantsFeatureServiceBoundary>;
  }
  render(<KeyboardShortcutsProvider initialPlatform="win32">{strict ? <StrictMode><App /></StrictMode> : <App />}</KeyboardShortcutsProvider>);
  try {
    // Rapid invocations before React commits must share one pending navigation decision.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', key: '4', ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', key: '4', ctrlKey: true }));
    });
    expect(confirmDiscardProjectFile).toHaveBeenCalledOnce();
    await act(async () => { finishDiscard(false); await discard; });
    expect(client.openConversation).not.toHaveBeenCalled();
    expect(getThread).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { code: 'Digit4', key: '4', ctrlKey: true });
    await screen.findByText('结果 local');
    // Slash text is an ordinary assistant message, never a workspace command.
    await user.type(screen.getByRole('textbox'), '/compact{Enter}');
    await waitFor(() => expect(sendTurn).toHaveBeenLastCalledWith('local', expect.objectContaining({ input: '/compact', thinking: true, thinkingEffort: 'high' })));
    const first = screen.getByRole<HTMLButtonElement>('button', { name: /任务 first/ });
    expect(first.disabled).toBe(false);
    fireEvent.click(first);
    await screen.findByText('结果 first');
    await user.type(screen.getByRole('textbox'), '项目消息');
    await user.click(screen.getByRole('button', { name: 'chat.composer.send' }));
    await waitFor(() => expect(sendTurn).toHaveBeenLastCalledWith('first', expect.objectContaining({ thinking: true, thinkingEffort: 'high' })));
    // The project conversation replaces the info panel; the home assistant entry remains usable.
    fireEvent.click(screen.getByRole('button', { name: '助理' }));
    await screen.findByText('结果 local');
    fireEvent.click(screen.getByRole('button', { name: /任务 second/ }));
    await screen.findByText('结果 second');
    await user.type(screen.getByRole('textbox'), '继续旧任务');
    await user.click(screen.getByRole('button', { name: 'chat.composer.send' }));
    await waitFor(() => expect(sendTurn).toHaveBeenLastCalledWith('second', expect.objectContaining({ thinking: true, thinkingEffort: 'medium' })));
    fireEvent.contextMenu(screen.getByRole('button', { name: '助理' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'feature.assistants.edit' }));
    const name = screen.getByLabelText('feature.assistants.name');
    fireEvent.change(name, { target: { value: '改名后的助理' } });
    fireEvent.click(screen.getByRole('button', { name: 'feature.assistants.save' }));
    await waitFor(() => expect(client.update).toHaveBeenCalledExactlyOnceWith('owner', expect.objectContaining({ name: '改名后的助理' })));
    expect(client.create).not.toHaveBeenCalled();
    expect(getThread.mock.calls.map(([id]) => id)).toEqual(['local', 'first', 'local', 'second']);
  } finally { await act(async () => { finishDiscard(false); finishRefresh([]); await refresh; }); }
});

function Conversation({ runtime, presentation, starterPresentation, turnNavigationRequest, defaultThinking, conversationInfo, conversationOverviewVisibility }: AppRouteContentProps & Pick<Parameters<typeof ChatWorkspace>[0], 'presentation' | 'starterPresentation' | 'turnNavigationRequest' | 'defaultThinking' | 'conversationInfo'>) {
  const [draft, setDraft] = useState('');
  const slots: RendererOwnedSlotRenderer = {
    chain: () => null as never, keyed: () => null, keyedEntries: () => [], list: () => null, listEntryIds: () => [],
    single: (_slot, props) => (props as { renderDefault?: () => ReactNode }).renderDefault?.() ?? null,
  };
  const noop = () => undefined;
  return <RendererPluginTestHost slots={slots}><ChatWorkspace
    presentation={presentation}
    conversationInfo={conversationInfo} conversationOverviewVisibility={conversationOverviewVisibility}
    activeTurnId={null} client={runtime.client} config={runtime.config} canClearContext={false}
    composerKey={runtime.currentThread?.id ?? 'new'} currentThread={runtime.currentThread} draft={draft} skills={[]}
    defaultThinking={defaultThinking}
    starterPresentation={starterPresentation} turnNavigationRequest={turnNavigationRequest}
    capabilitySelectionRequest={null} onCapabilitySelectionRequestConsumed={noop}
    onDraftChange={setDraft} onSend={async (value, options) => {
      await runtime.client.sendTurn(runtime.currentThread!.id, {
        input: value ?? '', thinking: options?.thinking, thinkingEffort: options?.thinkingEffort,
      });
      return true;
    }} onAnswerApproval={async () => undefined}
    onDeleteMessages={noop} onEditUserMessage={noop}
    queuedTurnActions={{ deleteQueuedTurnInput: vi.fn(), retrieveQueuedTurnInput: vi.fn(), reorderQueuedTurnInputs: vi.fn(), sendQueuedTurnInputNow: vi.fn() }}
    onAccessModeChange={noop} onCancelActiveTurn={noop} onClearContext={noop} onCompactContext={noop}
    onSelectModel={noop} onStartThreadReview={vi.fn()} onSearchProjectEntries={vi.fn()}
  /></RendererPluginTestHost>;
}
