// @vitest-environment happy-dom
import { parsePluginMentions, type RuntimePluginSummary, type RuntimePluginUiContribution } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { CreatePluginAppEntry } from '../../../../src/app/app-creation/CreatePluginAppEntry.js';
import { CapabilitiesRefreshBoundary } from '../../../../src/composition/CapabilitiesRefreshBoundary.js';
import { PluginManagementFeatureServiceBoundary } from '../../../../src/composition/PluginManagementFeatureBoundary.js';
import { usePluginAppCreation, type CreatePluginAppChat } from '../../../../src/app/app-creation/usePluginAppCreation.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { DeclarativePluginSidebarEntry } from '../../../../src/kernel/declarative-plugin-ui/DeclarativePluginSidebarEntry.js';

afterEach(async () => {
  cleanup();
  // Radix releases an unmounted dialog's focus scope in the next task.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
});

const plugin: RuntimePluginSummary = {
  id: 'app-builder', name: '应用构建器', installedAt: '',
  skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [],
};

const contribution: RuntimePluginUiContribution = {
  id: 'table.page', slot: 'renderer.plugin.page', navigation: { label: '我的表格' },
  document: { htmlResourceId: 'html', actionIds: [] },
};
function Entries({ onCreateApp, onFocusComposer }: { onCreateApp: CreatePluginAppChat; onFocusComposer(): void }) {
  const creation = usePluginAppCreation(onCreateApp, onFocusComposer);
  return <><CreatePluginAppEntry creation={creation} />
    <DeclarativePluginSidebarEntry active={false} contribution={contribution} entryId="table" missingContext={null}
      plugin={{ ...plugin, id: 'editable-table' }} service={{} as PluginManagementRendererService}
      onOpen={() => undefined} onRemove={async () => undefined} onViewPlugin={() => undefined}
      onModifyApp={(app) => { void creation.modify(app); }} />
  </>;
}

function setup(installed = true, openIntroduction = true) {
  const onCreateApp = vi.fn(async () => true);
  const refreshInstalled = vi.fn(async () => ({ plugins: installed ? [plugin] : [] }));
  const installMarketplace = vi.fn(async () => ({ plugin, installedMcpServers: [], reusedMcpServers: [] }));
  const refresh = vi.fn(async () => undefined);
  const composerRef = createRef<HTMLInputElement>();
  const onFocusComposer = vi.fn(() => composerRef.current?.focus());
  const onSubmit = vi.fn();
  render(<ToastProvider><CapabilitiesRefreshBoundary coordinator={{ refresh, refreshAll: refresh, register: () => () => undefined }}>
    <PluginManagementFeatureServiceBoundary service={{ refreshInstalled, installMarketplace } as unknown as PluginManagementRendererService}>
      <Entries onCreateApp={onCreateApp} onFocusComposer={onFocusComposer} />
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <input ref={composerRef} aria-label="Message" />
      </form>
    </PluginManagementFeatureServiceBoundary>
  </CapabilitiesRefreshBoundary></ToastProvider>);
  const opener = screen.getByRole('button', { name: '创建应用' });
  opener.focus();
  if (openIntroduction) fireEvent.click(opener);
  return { onCreateApp, refreshInstalled, installMarketplace, refresh, onFocusComposer, onSubmit, opener };
}

it('opens modification from the app context menu with its identity and builder, then leaves Enter in the composer', async () => {
  const user = userEvent.setup();
  const { onCreateApp, onFocusComposer, onSubmit } = setup(true, false);
  fireEvent.contextMenu(screen.getByRole('button', { name: '我的表格' }));
  await user.click(await screen.findByRole('menuitem', { name: '修改插件' }));
  await waitFor(() => expect(onCreateApp).toHaveBeenCalledOnce());
  const [builder, prompt] = onCreateApp.mock.calls[0] as unknown as Parameters<CreatePluginAppChat>;
  expect(builder.id).toBe('app-builder');
  expect(parsePluginMentions(prompt)).toEqual([expect.objectContaining({ pluginId: 'editable-table', contributionId: 'table.page' })]);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })));
  expect(onFocusComposer).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});

it('opens the selected chat and hands off focus so Enter submits instead of reopening the introduction', async () => {
  const user = userEvent.setup();
  const { onCreateApp, installMarketplace, onFocusComposer, onSubmit, opener } = setup();
  fireEvent.click(screen.getByRole('button', { name: '对话列表与汇总' }));
  await waitFor(() => expect(onCreateApp).toHaveBeenCalledWith(plugin, expect.stringContaining('读取所有项目和无项目的对话列表')));
  expect(installMarketplace).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })));
  expect(onFocusComposer).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onCreateApp).toHaveBeenCalledTimes(1);

  // A later cancellation still returns focus to the trigger, not the composer.
  await user.click(opener);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(onFocusComposer).toHaveBeenCalledTimes(1);
});

it('restores a missing built-in builder before opening the requested form chat', async () => {
  const { onCreateApp, installMarketplace, refresh } = setup(false);
  fireEvent.click(screen.getByRole('button', { name: '信息收集表单' }));
  await waitFor(() => expect(onCreateApp).toHaveBeenCalledWith(plugin, expect.stringContaining('校验必填项')));
  expect(installMarketplace).toHaveBeenCalledTimes(1);
  expect(installMarketplace).toHaveBeenCalledWith({ pluginId: 'app-builder' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(refresh).toHaveBeenCalledWith(['skills']);
});

it('keeps the introduction open with an actionable error when preparing a chat fails', async () => {
  const { onCreateApp, onFocusComposer } = setup();
  onCreateApp.mockRejectedValueOnce(new Error('无法创建对话'));
  fireEvent.click(screen.getByRole('button', { name: '可编辑表格' }));
  expect((await screen.findByRole('alert')).textContent).toBe('无法创建对话');
  expect(onFocusComposer).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '可编辑表格' })));
  await waitFor(() => expect(onCreateApp).toHaveBeenCalledTimes(2));
});
