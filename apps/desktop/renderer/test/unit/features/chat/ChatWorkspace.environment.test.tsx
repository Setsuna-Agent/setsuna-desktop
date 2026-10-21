// @vitest-environment happy-dom
import type { DesktopRuntimeClient, WorkspaceProject } from '@setsuna-desktop/contracts';
import { composeRendererMessages, type RendererOwnedSlotRenderer } from '@setsuna-desktop/feature-core/renderer';
import { terminalRendererFeature } from '@setsuna-desktop/feature-terminal/renderer';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppTopbarActions } from '../../../../src/app/layout/AppTopbarActions.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import type { ConversationOverviewVisibility } from '../../../../src/app/types.js';
import { TerminalActionsHostProvider } from '../../../../src/composition/TerminalWorkspaceFeatureBoundary.js';
import { ChatWorkspace } from '../../../../src/features/chat/ChatWorkspace.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';
import { RendererPluginTestHost } from '../../support/RendererPluginTestHost.js';

afterEach(() => { cleanup(); localStorage.clear(); });

it('opens the environment before a conversation exists and runs actions from the selected project after switching projects', async () => {
  const user = userEvent.setup();
  const runAction = vi.fn(async () => {});
  const createThread = vi.fn();
  const client = { listThreadMessages: vi.fn(), createThread } as unknown as DesktopRuntimeClient;
  const projects: WorkspaceProject[] = [
    { id: 'project-a', name: 'First', path: '/first', createdAt: '', updatedAt: '' },
    { id: 'project-b', name: 'Second', path: '/second', createdAt: '', updatedAt: '' },
  ];
  const actions = projects.map((project) => ({ id: project.id, name: project.name, command: `echo ${project.name}`, icon: 'play', platform: 'all' }));
  projects.forEach((project, index) => localStorage.setItem(`setsuna.desktop.terminal.actions.v1:${project.id}`,
    JSON.stringify({ actions: [actions[index]], selectedId: actions[index].id })));

  const view = render(<Harness client={client} runAction={runAction} />);
  // Opening and closing works even before a project is chosen; it must not create a conversation.
  await user.click(screen.getByRole('button', { name: '显示环境信息' }));
  await user.click(screen.getByRole('button', { name: '隐藏环境信息' }));
  view.rerender(<Harness client={client} runAction={runAction} project={projects[0]} />);
  await user.click(screen.getByRole('button', { name: '显示环境信息' }));
  await user.click(await screen.findByRole('button', { name: '运行 First' }));
  expect(runAction).toHaveBeenLastCalledWith(actions[0]);
  view.rerender(<Harness client={client} runAction={runAction} project={projects[1]} />);
  await user.click(await screen.findByRole('button', { name: '运行 Second' }));
  expect(runAction).toHaveBeenLastCalledWith(actions[1]);
  expect(runAction).toHaveBeenCalledTimes(2);
  expect(createThread).not.toHaveBeenCalled();
  expect(client.listThreadMessages).not.toHaveBeenCalled();
});

const messageCatalog = composeRendererMessages(hostMessages, [{ module: terminalRendererFeature }]);
const slots: RendererOwnedSlotRenderer = {
  chain: () => null as never, keyed: () => null, keyedEntries: () => [], list: () => null, listEntryIds: () => [],
  single: (_slot, props) => (props as { renderDefault?: () => ReactNode }).renderDefault?.() ?? null,
};
const noop = () => undefined;

function Harness({ client, project, runAction }: {
  client: DesktopRuntimeClient;
  project?: WorkspaceProject;
  runAction: () => Promise<void>;
}) {
  const [visibility, setVisibility] = useState<ConversationOverviewVisibility>('hidden');
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState('');
  return <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}><ToastProvider>
    <RendererPluginTestHost slots={slots}>
      <TerminalActionsHostProvider host={{ projects: project ? [project] : [], platform: 'darwin', runAction, openSettings: noop }}>
        <AppTopbarActions activeView="chat" bottomPanelVisible={false} sidePanelVisible={false}
          conversationOverviewVisible={visible} onToggleConversationOverview={() => setVisibility(visible ? 'hidden' : 'shown')}
          onToggleBottomTerminal={noop} onToggleSidePanel={noop} />
        <ChatWorkspace activeProject={project} activeTurnId={null} client={client} config={null} canClearContext={false}
          composerKey="new-thread-slot:test" currentThread={null} draft={draft} skills={[]}
          conversationOverviewVisibility={visibility} onConversationOverviewRenderedChange={setVisible}
          capabilitySelectionRequest={null} onCapabilitySelectionRequestConsumed={noop}
          onDraftChange={setDraft} onSend={async () => false} onAnswerApproval={async () => undefined}
          onDeleteMessages={noop} onEditUserMessage={noop} onAccessModeChange={noop}
          onCancelActiveTurn={noop} onClearContext={noop} onCompactContext={noop}
          onSelectModel={noop} onSetMultiAgentEnabled={noop} onStartThreadReview={vi.fn()} onSearchProjectEntries={vi.fn()}
          queuedTurnActions={{ deleteQueuedTurnInput: vi.fn(), releaseQueuedTurnInputEdit: vi.fn(), retrieveQueuedTurnInput: vi.fn(),
            reorderQueuedTurnInputs: vi.fn(), sendQueuedTurnInputNow: vi.fn(), updateQueuedTurnInput: vi.fn() }} />
      </TerminalActionsHostProvider>
    </RendererPluginTestHost>
  </ToastProvider></I18nProvider>;
}
