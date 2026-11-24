// @vitest-environment happy-dom
import { parsePluginMentions, type DesktopRuntimeClient, type RuntimeThread, type SendTurnInput, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { parseDesignSelectionMentions, type DesignSelectionReference } from '@setsuna-desktop/feature-design/contracts/design-selection-mention';
import { DesignChatFullscreenContext } from '@setsuna-desktop/feature-design/renderer';
import { appReadySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { activateBuiltinRendererFeatures } from '../../../../src/composition/renderer-feature-composition.js';
import { RendererKernelProvider, RendererOwnedKeyedSlot, RendererRootSingleSlot } from '../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppRouteSurface } from '../../../../src/app/layout/AppRouteSurface.js';
import { DesignRouteBusyContext } from '../../../../src/composition/design/DesignChatHost.js';
import DesignChatSidebar from '../../../../src/composition/design/DesignChatSidebar.js';

vi.mock('../../../../src/composition/SkillsFeatureBoundary.js', () => ({
  useSkillsFeatureSnapshot: () => ({ skills: [{ id: 'layout', name: 'Layout', kind: 'builtin', enabled: true }] }),
}));
vi.mock('../../../../src/composition/PluginManagementFeatureBoundary.js', () => ({
  usePluginManagementFeatureSnapshot: () => ({ plugins: [{ id: 'tables', name: 'Tables', skills: [], mcpServers: [], hooks: [], resources: [] }] }),
}));
vi.mock('../../../../src/composition/ReviewFeatureBoundary.js', () => ({ useReviewFeatureService: () => ({}) }));
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it('finishes a design turn across main-page navigation and reopens the conversation in the file panel', async ({ onTestFinished }) => {
  vi.stubGlobal('setsunaDesktop', {
    desktop: { platform: 'darwin' },
    runtime: { request: vi.fn().mockResolvedValue({ ok: true, value: { plugins: [] } }), startSse: () => () => undefined },
  });
  const features = await activateBuiltinRendererFeatures();
  onTestFinished(() => features.composition.dispose());
  const project = { id: 'project', path: '/project', name: 'Design' } as WorkspaceProject;
  let beginPick: (() => ((reference: DesignSelectionReference) => void) | undefined) | undefined;
  const reference = { documentId: 'canvas', boards: ['sidebar'], ids: ['active:rail', 'line/2'], label: '菜单短线 +1' };
  const binding = { subscribePicks(listener: NonNullable<typeof beginPick>) { beginPick = listener; return () => { beginPick = undefined; }; }, reveal: vi.fn(),
    ref: { projectId: project.id, path: 'file.design.json' }, documentId: 'canvas',
    bind: vi.fn(async (): Promise<void> => {}), release: vi.fn(async () => undefined) };
  const chat = { id: 'design-chat', title: 'Layout' };
  const thread = { ...chat, lastSeq: 0, turns: [], messages: [], createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' } as unknown as RuntimeThread;
  const earlier = { id: 'earlier-chat', title: 'Earlier design', legacy: true };
  const earlierThread: RuntimeThread = { ...thread, id: earlier.id, title: earlier.title, messages: [
    { id: 'reference', role: 'user', content: 'Earlier design reference', createdAt: thread.createdAt },
  ] };
  let created = false;
  let finishCreate!: () => void;
  const creation = new Promise<void>((resolve) => { finishCreate = resolve; });
  const conversations = { list: vi.fn(async () => [
    ...(created ? [chat] : []), ...(earlierThread.archived ? [] : [earlier]),
  ]), create: vi.fn(async () => { await creation; created = true; return chat; }) };
  const image = new File(['png'], 'card.png', { type: 'image/png' });
  const attachment = { id: 'card', assetId: 'card', source: 'runtime', type: image.type, name: image.name, size: image.size };
  const sendTurn = vi.fn(async (id: string, input: SendTurnInput) => {
    if (!thread.messages.length) {
      thread.activeTurnId = 'turn';
      thread.lastSeq = 2;
    }
    thread.messages.push({ id: 'message-' + thread.messages.length, turnId: 'turn', role: 'user', content: input.input,
      clientId: input.clientId, createdAt: thread.createdAt, attachments: input.attachments, skillReferences: input.skillReferences });
    return { turnId: 'turn' };
  });
  const sendQueuedTurnInputNow = vi.fn(async () => ({ disposition: 'started', turnId: 'resumed' }));
  let onBatch!: Parameters<DesktopRuntimeClient['subscribeEvents']>[2];
  const unsubscribe = vi.fn();
  const subscribeEvents = vi.fn((id: string, _seq: number, listener: typeof onBatch) => {
    onBatch = listener;
    return () => { unsubscribe(id); };
  });
  const updateThread = vi.fn<DesktopRuntimeClient['updateThread']>(async (id, patch) => {
    const target = id === earlier.id ? earlierThread : thread;
    return Object.assign(target, patch);
  });
  const client = { sendTurn, sendQueuedTurnInputNow, updateThread, getThread: async (id: string) => structuredClone(id === earlier.id ? earlierThread : thread), linkAttachment: vi.fn(async () => attachment),
    subscribeEvents,
    deleteAttachment: vi.fn(), getThreadIfChanged: async () => null,
    searchProjectEntries: vi.fn(async () => ({ entries: [] })) } as unknown as DesktopRuntimeClient;
  const renderChat = (onBusyChange?: (busy: boolean) => void) => <DesignChatSidebar binding={{ ...binding, onBusyChange }} project={project} conversations={conversations}
    runtime={{ client, config: null, selectConversationModel: vi.fn(), saveRuntimePreferences: vi.fn() }} />;
  const renderFile = () => <RendererOwnedKeyedSlot slot={workspacePanelSlot} entryKey="file" instanceKey="file" props={{
    panelId: 'file', panelType: 'file', placement: 'side', projectId: project.id, threadId: null,
    surfaceInstanceId: 'file', translate: (key) => key, visible: true, renderDefault: renderChat,
  }} />;
  type Route = 'design' | 'chat' | 'settings';
  const tree = (activeView: Route) => (
    <I18nProvider initialLocale="zh-CN" messageCatalog={features.messages}><ToastProvider>
      <RendererKernelProvider runtime={features.rendererPlugins}>
        <RendererRootSingleSlot slot={appReadySlot} props={{
          renderDefault: () => <AppRouteSurface activeView={activeView} pluginProps={{ selectedViewKey: null, onBack: () => {} }}
            renderDefault={(routeId) => routeId === 'design'
              ? <DesignChatFullscreenContext.Provider value><DesignRouteBusyContext.Consumer>
                {(onBusyChange) => renderChat(onBusyChange)}
              </DesignRouteBusyContext.Consumer></DesignChatFullscreenContext.Provider>
              : routeId === 'chat' ? renderFile() : null} />,
        }} />
      </RendererKernelProvider>
    </ToastProvider></I18nProvider>
  );
  const mount = (routeId: Route) => render(tree(routeId));
  const sidebar = mount('design');
  const earlierChat = await screen.findByRole<HTMLButtonElement>('button', { name: earlier.title });
  await waitFor(() => expect(earlierChat.disabled).toBe(false));
  fireEvent.click(earlierChat);
  await screen.findByText('Earlier design reference');
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新建设计对话' }));
  const input = await screen.findByRole('textbox');
  const paste = (text: string) => fireEvent.paste(input, { clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? text : '' } });
  paste('/');
  fireEvent.mouseDown(await screen.findByRole('option', { name: /Layout/ }));
  paste('/');
  fireEvent.mouseDown(await screen.findByRole('option', { name: /Tables/ }));
  paste('Use this card');
  const canvasFocus = screen.getByRole('button', { name: '新建设计对话' });
  canvasFocus.focus();
  act(() => { beginPick!()!(reference); beginPick!()!(reference); });
  expect(document.activeElement).toBe(canvasFocus);
  const chip = await screen.findByRole('button', { name: reference.label });
  expect(input.contains(chip)).toBe(true);
  fireEvent.click(chip);
  expect(binding.reveal).toHaveBeenCalledWith(reference);
  const data = new DataTransfer();
  data.items.add(image);
  await act(async () => { fireEvent.drop(input, { dataTransfer: data }); });
  const quickPrompt = '这份设计稿哪里最值得先改？';
  fireEvent.click(await screen.findByRole('button', { name: quickPrompt }));
  expect(document.activeElement).toBe(input);
  expect(input.textContent).toContain('Use this card');
  expect(input.textContent).toContain(quickPrompt);
  expect(conversations.create).not.toHaveBeenCalled();
  expect(sendTurn).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(conversations.create).toHaveBeenCalledOnce());
  sidebar.rerender(tree('settings'));
  await act(async () => { finishCreate(); });
  await waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
  const [id, sent] = sendTurn.mock.calls[0]!;
  expect(id).toBe(chat.id);
  expect(sent.input).toContain(quickPrompt);
  expect(binding.bind).toHaveBeenLastCalledWith(id, reference.ids, sent.clientId);
  expect(parseDesignSelectionMentions(sent.input).map((mention) => mention.reference)).toEqual([reference]);
  expect(parsePluginMentions(sent.input)).toMatchObject([{ pluginId: 'tables' }]);
  expect(sent).toMatchObject({ attachments: [attachment], skillReferences: [{ skillId: 'layout' }] });
  await waitFor(() => expect(subscribeEvents).toHaveBeenCalledWith(chat.id, expect.any(Number), expect.any(Function)));
  const firstTurnEvent = { threadId: chat.id, turnId: 'turn', createdAt: thread.createdAt };
  act(() => onBatch({ events: [
    { ...firstTurnEvent, seq: 1, id: 'started', type: 'turn.started', payload: { input: sent.input } },
    { ...firstTurnEvent, seq: 2, id: 'sent', type: 'message.created', payload: { message: thread.messages[0]! } },
  ] }));
  sidebar.rerender(tree('design'));
  await screen.findByText(/Use this card/u);
  sidebar.rerender(tree('settings'));
  expect(unsubscribe).not.toHaveBeenCalledWith(chat.id);
  expect(binding.release).not.toHaveBeenCalled();
  const answer = { id: 'answer', role: 'assistant', status: 'complete', phase: 'final_answer', turnId: 'turn',
    createdAt: thread.createdAt, content: 'The layout has been updated.' } satisfies RuntimeThread['messages'][number];
  thread.messages.push(answer);
  delete thread.activeTurnId;
  thread.lastSeq = 4;
  act(() => onBatch({ events: [
    { ...firstTurnEvent, seq: 3, id: 'answer-created', type: 'message.created', payload: { message: answer } },
    { ...firstTurnEvent, seq: thread.lastSeq, id: 'completed', type: 'turn.completed', payload: {} },
  ] }));
  await waitFor(() => expect(unsubscribe).toHaveBeenCalledWith(chat.id));
  expect(binding.release).toHaveBeenCalledOnce();
  sidebar.rerender(tree('design'));
  await screen.findByText(answer.content);
  sidebar.unmount();
  type History = Awaited<ReturnType<typeof conversations.list>>;
  let rejectStaleHistory!: (error: Error) => void;
  let resolveRefreshedHistory!: (items: History) => void;
  const staleHistory = new Promise<never>((_, reject) => { rejectStaleHistory = reject; });
  const refreshedHistory = new Promise<History>((resolve) => { resolveRefreshedHistory = resolve; });
  conversations.list.mockReturnValueOnce(staleHistory).mockReturnValueOnce(refreshedHistory);
  const reopened = mount('chat');
  await waitFor(() => expect(conversations.list.mock.results.at(-1)?.value).toBe(staleHistory));
  fireEvent(window, new Event('focus'));
  expect(conversations.list.mock.results.at(-1)?.value).toBe(refreshedHistory);
  await act(async () => rejectStaleHistory(new Error('Previous history request failed.')));
  await act(async () => resolveRefreshedHistory([chat, earlier]));
  await screen.findByText(/Use this card/u);
  fireEvent.click(await screen.findByRole('button', { name: reference.label }));
  expect(binding.reveal).toHaveBeenCalledTimes(2);
  const followup = screen.getByRole('textbox');
  fireEvent.paste(followup, { clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? 'Tighten the gap' : '' } });
  await act(async () => { fireEvent.keyDown(followup, { key: 'Enter' }); });
  expect(sendTurn).toHaveBeenLastCalledWith(chat.id, expect.objectContaining({ input: 'Tighten the gap' }));
  expect(binding.bind).toHaveBeenLastCalledWith(chat.id, undefined, sendTurn.mock.calls.at(-1)![1].clientId);
  expect(conversations.create).toHaveBeenCalledOnce();

  reopened.unmount();
  thread.queuedTurnInputs = [{ id: 'paused', clientId: 'original-input', input: 'Update the card', createdAt: thread.createdAt,
    editorSelection: { documentId: binding.documentId, ids: ['card-b'] } },
    { id: 'old', input: 'Edit the selection', createdAt: thread.createdAt }];
  let finishBinding!: () => void;
  binding.bind.mockImplementationOnce(() => new Promise<void>((resolve) => { finishBinding = resolve; }));
  mount('design');
  const [resume, legacy] = await screen.findAllByRole('button', { name: '立即发送' });
  await act(async () => { fireEvent.click(legacy); });
  expect(sendQueuedTurnInputNow).not.toHaveBeenCalled();
  fireEvent.click(resume);
  await waitFor(() => expect(binding.bind).toHaveBeenLastCalledWith(chat.id, ['card-b'], 'original-input'));
  expect(sendQueuedTurnInputNow).not.toHaveBeenCalled();
  await act(async () => finishBinding());
  await waitFor(() => expect(sendQueuedTurnInputNow).toHaveBeenCalledExactlyOnceWith(chat.id, 'paused'));
  const newChat = screen.getByRole<HTMLButtonElement>('button', { name: '新建设计对话' });
  expect(newChat.disabled).toBe(true);
  binding.release.mockClear();
  const event = { threadId: chat.id, turnId: 'resumed', createdAt: thread.createdAt };
  act(() => onBatch({ events: [
    { ...event, seq: thread.lastSeq + 1, id: 'error', type: 'runtime.error', payload: { message: 'Model unavailable' } },
    { ...event, seq: thread.lastSeq + 2, id: 'end', type: 'turn.completed', payload: {} },
  ] }));
  await waitFor(() => expect(newChat.disabled).toBe(false));
  expect(binding.release).toHaveBeenCalledOnce();
  expect(screen.getAllByRole('button', { name: '立即发送' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: earlier.title }));
  await screen.findByText('Earlier design reference');
  fireEvent.click(screen.getByRole('button', { name: '归档对话' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: earlier.title })).toBeNull());
  await screen.findByText('Tighten the gap');
  expect(earlierThread.archived).toBe(true);
});
