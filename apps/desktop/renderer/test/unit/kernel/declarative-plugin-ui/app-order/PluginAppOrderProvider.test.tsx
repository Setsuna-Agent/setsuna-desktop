// @vitest-environment happy-dom
import { declareRendererChildSlot, defineRendererPlugin } from '@setsuna-desktop/feature-core/renderer';
import { appReadySlot, shellSidebarPluginEntrySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { PluginAppOrderProvider, usePluginAppOrderEntry } from '../../../../../src/kernel/declarative-plugin-ui/app-order/PluginAppOrderProvider.js';
import { RendererKernelProvider, RendererOwnedListSlot, RendererOwnedSlotsProvider, RendererRootSingleSlot } from '../../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererLayoutPreferenceStore } from '../../../../../src/kernel/renderer-plugins/layout-preferences.js';
import { createRendererPluginRuntime, type RendererPluginRuntime } from '../../../../../src/kernel/renderer-plugins/runtime.js';

const runtimes: RendererPluginRuntime[] = [];
afterEach(async () => {
  cleanup();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function setup() {
  const store = createRendererLayoutPreferenceStore(window.localStorage);
  const runtime = createRendererPluginRuntime({ initialPreferences: store.load().preferences });
  runtimes.push(runtime);
  const owner = { pluginId: 'core.app-order-test', scopeId: 'test:app-order' };
  const onOpen = vi.fn();
  runtime.declareRoot(owner, { slot: appReadySlot, required: true });
  const ui = runtime.createRegistrar(owner);
  ui.single(appReadySlot, {
    id: 'test.shell', children: [declareRendererChildSlot(shellSidebarPluginEntrySlot)],
    render: (_props, slots) => <RendererOwnedSlotsProvider slots={slots}>
      <PluginAppOrderProvider>
        <RendererOwnedListSlot slot={shellSidebarPluginEntrySlot} props={{ activeViewKey: null, onOpen, onViewPlugin: vi.fn(), onModifyApp: vi.fn() }} />
      </PluginAppOrderProvider>
      <button type="button">Create app</button>
    </RendererOwnedSlotsProvider>,
  });
  for (const [index, id] of ['app.a', 'app.b', 'app.c'].entries()) {
    ui.list(shellSidebarPluginEntrySlot, { id, order: index, render: () => <AppButton id={id} onOpen={onOpen} /> });
  }
  runtime.commitInitial();
  const view = render(<RendererKernelProvider runtime={runtime}><ToastProvider>
    <RendererRootSingleSlot slot={appReadySlot} props={{ renderDefault: () => null }} />
  </ToastProvider></RendererKernelProvider>);
  const order = () => {
    const snapshot = runtime.getSnapshot();
    return snapshot.resolveList(shellSidebarPluginEntrySlot, snapshot.resolveSingle(appReadySlot).entries[0]).entries.map((entry) => entry.entryId);
  };
  return { ...view, runtime, store, order, onOpen };
}

function AppButton({ id, onOpen }: { id: string; onOpen(): void }) {
  const { buttonProps } = usePluginAppOrderEntry(id);
  return <button type="button" {...buttonProps} onClick={onOpen}>{id}</button>;
}

function transfer() {
  const values = new Map<string, string>();
  return {
    get types() { return [...values.keys()]; },
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
    effectAllowed: 'none', dropEffect: 'none',
  };
}

function drag(type: string, node: HTMLElement, { dataTransfer, clientY = 0 }: { dataTransfer: ReturnType<typeof transfer>; clientY?: number }) {
  // happy-dom's DragEvent omits mouse coordinates; provide the browser event shape explicitly.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  fireEvent(node, event);
}

it('commits a drop, restores the saved app order, and keeps creation outside the ordered slot', async () => {
  const view = setup();
  const dataTransfer = transfer();
  const source = screen.getByRole('button', { name: 'app.c' });
  const target = screen.getByRole('button', { name: 'app.a' });
  fireEvent.dragStart(source, { dataTransfer });
  drag('dragover', target, { dataTransfer, clientY: -1 });
  expect(view.order()).toEqual(['app.a', 'app.b', 'app.c']);
  drag('drop', target, { dataTransfer, clientY: -1 });
  await waitFor(() => expect(view.store.load().preferences.listPreferences[shellSidebarPluginEntrySlot.id]?.order).toEqual(['app.c', 'app.a', 'app.b']));
  expect(view.order()).toEqual(['app.c', 'app.a', 'app.b']);
  expect(view.onOpen).not.toHaveBeenCalled();
  view.unmount();
  const restored = setup();
  expect(restored.order()).toEqual(['app.c', 'app.a', 'app.b']);
  const moved = screen.getByRole('button', { name: 'app.c' });
  fireEvent.dragStart(moved, { dataTransfer });
  drag('drop', screen.getByRole('button', { name: 'app.b' }), { dataTransfer, clientY: 1 });
  await waitFor(() => expect(restored.store.load().preferences.listPreferences[shellSidebarPluginEntrySlot.id]?.order).toEqual(['app.a', 'app.b', 'app.c']));
  fireEvent.dragStart(screen.getByRole('button', { name: 'app.c' }), { dataTransfer });
  drag('drop', screen.getByRole('button', { name: 'app.a' }), { dataTransfer, clientY: -1 });
  await waitFor(() => expect(restored.store.load().preferences.listPreferences[shellSidebarPluginEntrySlot.id]?.order).toEqual(['app.c', 'app.a', 'app.b']));

  // A preference commit must retain the registry for subsequent installs and removals.
  const remove = await act(() => restored.runtime.mount(defineRendererPlugin({
    id: 'feature.new-app',
    activate({ ui }) {
      ui.list(shellSidebarPluginEntrySlot, { id: 'app.new', order: -1, render: () => <AppButton id="app.new" onOpen={restored.onOpen} /> });
    },
  })));
  expect(restored.order()).toEqual(['app.c', 'app.a', 'app.b', 'app.new']);
  await act(async () => { await remove(); });
  expect(restored.order()).toEqual(['app.c', 'app.a', 'app.b']);
});

it('leaves the saved order intact after drag cancellation or an external drop', () => {
  const view = setup();
  const dataTransfer = transfer();
  fireEvent.dragStart(screen.getByRole('button', { name: 'app.a' }), { dataTransfer });
  drag('dragover', screen.getByRole('button', { name: 'app.c' }), { dataTransfer, clientY: 1 });
  fireEvent.dragEnd(screen.getByRole('button', { name: 'app.a' }), { dataTransfer });
  const external = transfer();
  external.setData('text/plain', 'app.c');
  drag('drop', screen.getByRole('button', { name: 'app.a' }), { dataTransfer: external });
  expect(view.order()).toEqual(['app.a', 'app.b', 'app.c']);
  expect(view.store.load().preferences.listPreferences).toEqual({});
});

it('restores the previous order when saving fails', async () => {
  const view = setup();
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  const dataTransfer = transfer();
  fireEvent.dragStart(screen.getByRole('button', { name: 'app.a' }), { dataTransfer });
  drag('drop', screen.getByRole('button', { name: 'app.c' }), { dataTransfer, clientY: 1 });
  await screen.findByText('排序保存失败，请重试。');
  expect(view.order()).toEqual(['app.a', 'app.b', 'app.c']);
  expect(view.store.load().preferences.listPreferences).toEqual({});
});
