// @vitest-environment happy-dom

import { parseRuntimePluginUiManifest, type RuntimePluginSummary, type RuntimePluginUiData } from '@setsuna-desktop/contracts';
import { declareRendererChildSlot, defineSingleRendererSlot } from '@setsuna-desktop/feature-core/renderer';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { shellPluginPageSlot, shellRouteSlot, shellSidebarPluginEntrySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppRouteSurface } from '../../../../src/app/layout/AppRouteSurface.js';
import { usePluginPageRefreshRequests } from '../../../../src/app/layout/usePluginPageSessions.js';
import { activateDeclarativePluginUiGateway } from '../../../../src/kernel/declarative-plugin-ui/gateway.js';
import { RendererKernelProvider, RendererOwnedListSlot, RendererOwnedSlotsProvider, RendererRootSingleSlot } from '../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

// Model the isolated page's own draft/route while exercising the real page loader,
// scoped data bridge, Slot ownership, navigation and context-menu refresh chain.
vi.mock('../../../../src/kernel/sandboxed-plugin-ui/SandboxedUiFrame.js', () => ({
  SandboxedUiFrame({ context, onAction }: { context: RuntimePluginUiData; onAction(id: string, payload: RuntimePluginUiData): Promise<void> }) {
    const [draft, setDraft] = useState('');
    const [detail, setDetail] = useState(false);
    const id = String(context.pluginId);
    return <>
      <input aria-label={`Draft ${id}`} value={draft} onChange={event => setDraft(event.target.value)} />
      <button onClick={() => setDetail(true)}>Detail {id}</button>
      <output>{detail ? `${id} detail` : `${id} home`}</output>
      <button onClick={() => { void onAction(`${id}.save`, { title: draft }); }}>Save {id}</button>
    </>;
  },
}));

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  window.localStorage.clear();
});

it('loads apps on first use and preserves each draft and route across app/chat/context switches', async () => {
  const fixture = await createFixture();
  expect(fixture.readDocument).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'notes' }));
  fireEvent.change(await screen.findByLabelText('Draft notes'), { target: { value: 'Unfinished note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Detail notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'tasks' }));
  fireEvent.change(await screen.findByLabelText('Draft tasks'), { target: { value: 'Unfinished task' } });
  fireEvent.click(screen.getByRole('button', { name: 'Chats' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change chat context' }));
  fireEvent.click(screen.getByRole('button', { name: 'notes' }));
  await waitFor(() => expect((screen.getByLabelText('Draft notes') as HTMLInputElement).value).toBe('Unfinished note'));
  expect(screen.getByText('notes detail')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
  await waitFor(() => expect(fixture.runAction).toHaveBeenCalledWith(expect.objectContaining({
    pluginId: 'notes', payload: { title: 'Unfinished note' }, context: expect.objectContaining({ projectId: 'project-b', threadId: 'thread-b' }),
  })));
  fireEvent.click(screen.getByRole('button', { name: 'tasks' }));
  expect((screen.getByLabelText('Draft tasks') as HTMLInputElement).value).toBe('Unfinished task');
  expect(fixture.readDocument).toHaveBeenCalledTimes(2);
  expect(fixture.runtime.getSnapshot().inspect().renderErrors).toEqual([]);
});

it('refreshes only the chosen cached app through its sidebar context menu', async () => {
  const fixture = await createFixture();
  fireEvent.click(screen.getByRole('button', { name: 'notes' }));
  fireEvent.change(await screen.findByLabelText('Draft notes'), { target: { value: 'Old draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'tasks' }));
  fireEvent.change(await screen.findByLabelText('Draft tasks'), { target: { value: 'Keep this task' } });
  fireEvent.contextMenu(screen.getByRole('button', { name: 'notes' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Refresh' }));
  await waitFor(() => expect(fixture.readDocument).toHaveBeenCalledTimes(3));
  await waitFor(() => expect((screen.getByLabelText('Draft notes') as HTMLInputElement).value).toBe(''));
  expect((screen.getByLabelText('Draft tasks') as HTMLInputElement).value).toBe('Keep this task');
  fireEvent.click(screen.getByRole('button', { name: 'notes' }));
  expect(fixture.readDocument).toHaveBeenCalledTimes(3);
});

it('releases an untrusted cached page and ignores a late response without blocking other apps', async () => {
  let finish: ((value: { html: string; css: string; js: string }) => void) | undefined;
  const pending = new Promise<{ html: string; css: string; js: string }>(resolve => { finish = resolve; });
  const fixture = await createFixture();
  fixture.readDocument.mockImplementationOnce(() => pending);
  fireEvent.click(screen.getByRole('button', { name: 'notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'tasks' }));
  await screen.findByLabelText('Draft tasks');
  await act(async () => { fixture.revokeNotes(); });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'notes' })).toBeNull());
  const options = fixture.readDocument.mock.calls[0][1] as { signal: AbortSignal };
  expect(options.signal.aborted).toBe(true);
  await act(async () => { finish?.({ html: '<div/>', css: '', js: '' }); await pending; });
  expect(screen.queryByLabelText('Draft notes')).toBeNull();
  expect(screen.getByLabelText('Draft tasks')).toBeTruthy();
});

async function createFixture() {
  const plugins = [appPlugin('notes'), appPlugin('tasks')];
  const listeners = new Set<() => void>();
  const readDocument = vi.fn(async (_input: unknown, _options?: unknown) => ({ html: '<div/>', css: '', js: '' }));
  const runAction = vi.fn(async () => ({ status: 'completed' }));
  const service = {
    getSnapshot: () => ({ plugins, catalogRevision: 'fixture' }),
    refreshInstalled: async () => undefined,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeRendererUiData: () => () => undefined,
    readRendererUiDocument: readDocument,
    readRendererUiData: async () => ({ data: {} }),
    runRendererUiAction: runAction,
  } as unknown as PluginManagementRendererService;
  const runtime = createRendererPluginRuntime();
  const root = defineSingleRendererSlot<object>({ id: 'renderer.fixture.sessions', scope: 'app' });
  const owner = { pluginId: 'core.fixture', scopeId: 'sessions' };
  runtime.declareRoot(owner, { slot: root, required: true });
  const ui = runtime.createRegistrar(owner);
  ui.single(root, {
    id: 'fixture.shell', children: [declareRendererChildSlot(shellSidebarPluginEntrySlot), declareRendererChildSlot(shellRouteSlot)],
    render: (_props, slots) => <RendererOwnedSlotsProvider slots={slots}><Navigation /></RendererOwnedSlotsProvider>,
  });
  ui.keyed(shellRouteSlot, { id: 'fixture.chat', key: 'chat', render: () => null });
  ui.keyed(shellRouteSlot, {
    id: 'fixture.plugin', key: 'plugin', children: [declareRendererChildSlot(shellPluginPageSlot, { fallback: { render: props => props.renderUnavailable() } })],
    render: ({ renderDefault }, slots) => <RendererOwnedSlotsProvider slots={slots}>{renderDefault()}</RendererOwnedSlotsProvider>,
  });
  runtime.commitInitial();
  const dispose = activateDeclarativePluginUiGateway(runtime, service, { refresh: async () => undefined });
  disposers.push(() => runtime.dispose(), async () => { await dispose(); });
  render(<I18nProvider initialLocale="en-US"><RendererKernelProvider runtime={runtime}>
    <RendererRootSingleSlot slot={root} props={{}} />
  </RendererKernelProvider></I18nProvider>);
  await screen.findByRole('button', { name: 'notes' });
  return { readDocument, runAction, runtime, revokeNotes() {
    plugins[0].extension!.trust = 'untrusted';
    for (const listener of listeners) listener();
  } };
}

function Navigation() {
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'chat' | 'plugin'>('chat');
  const [context, setContext] = useState({ activeProjectId: 'project-a', activeThreadId: 'thread-a' });
  const refresh = usePluginPageRefreshRequests();
  return <>
    <button onClick={() => setActiveView('chat')}>Chats</button>
    <button onClick={() => setContext({ activeProjectId: 'project-b', activeThreadId: 'thread-b' })}>Change chat context</button>
    <RendererOwnedListSlot slot={shellSidebarPluginEntrySlot} props={{
      activeViewKey: activeView === 'plugin' ? viewKey : null,
      onOpen: key => { setViewKey(key); setActiveView('plugin'); }, onRefresh: refresh.refresh,
      onViewPlugin: () => undefined, onModifyApp: () => undefined,
    }} />
    <AppRouteSurface activeView={activeView} pluginProps={{ ...context, selectedViewKey: viewKey,
      refreshRequests: refresh.requests, onBack: () => setActiveView('chat') }} renderDefault={() => null} />
  </>;
}

function appPlugin(id: string): RuntimePluginSummary {
  return { id, name: id, installedAt: '2026-10-12T00:00:00Z', skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [],
    extension: { apiVersion: 1, runtime: 'node-worker', capabilities: ['ui', 'state'], trust: 'trusted',
      rendererUi: parseRuntimePluginUiManifest({ schemaVersion: 2, actions: [{ id: `${id}.save` }], contributions: [{
        id: 'home', slot: 'renderer.plugin.page', navigation: { label: id }, data: { stateKey: 'view', scope: 'global' },
        reactApp: { root: 'app', entry: 'App.tsx', actionIds: [`${id}.save`] },
      }] }),
    },
  };
}
