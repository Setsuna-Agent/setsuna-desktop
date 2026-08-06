import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeMessageAttachment,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyChatComposerFocusRequest,
  ChatComposer,
} from '../../../../src/features/chat/ChatComposer.js';

const composerHarness = vi.hoisted(() => ({
  attachments: {} as Record<string, unknown>,
  command: {} as Record<string, unknown>,
  mode: {} as Record<string, unknown>,
  queuedEdit: {} as Record<string, unknown>,
}));

vi.mock('@ant-design/x', async () => {
  const React = await import('react');
  const Sender = React.forwardRef(({
    footer,
    header,
  }: {
    footer?: (actions: React.ReactNode) => React.ReactNode;
    header?: React.ReactNode;
  }, _ref) => (
    <div data-component="sender">
      {header}
      {footer?.(<button type="button" data-action="sender-default">default</button>)}
    </div>
  ));
  Sender.displayName = 'MockSender';
  return { Sender };
});

vi.mock('antd', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
  Dropdown: ({ children }: { children?: React.ReactNode }) => children,
  Tooltip: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../../../../src/shared/i18n/I18nProvider.js', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../../src/features/chat/composer/ChatApprovalPolicyMenu.js', () => ({
  ChatApprovalPolicyMenu: () => <div data-component="approval-policy" />,
}));

vi.mock('../../../../src/features/chat/composer/ChatAttachmentTray.js', () => ({
  ChatAttachmentTray: () => <div data-component="attachment-tray" />,
}));

vi.mock('../../../../src/features/chat/composer/ChatCommandMenus.js', () => ({
  ProjectEntryCommandMenu: () => <div data-overlay="mention" />,
}));

vi.mock('../../../../src/features/chat/composer/ChatModelPicker.js', () => ({
  ChatModelPicker: () => <div data-component="model-picker" />,
}));

vi.mock('../../../../src/features/chat/composer/ChatSendQueue.js', () => ({
  ChatSendQueue: () => <div data-component="send-queue" />,
}));

vi.mock('../../../../src/features/chat/composer/ChatSlashCommandMenu.js', () => ({
  ChatSlashCommandMenu: () => <div data-overlay="slash" />,
}));

vi.mock('../../../../src/features/chat/composer/useChatAttachments.js', () => ({
  useChatAttachments: () => composerHarness.attachments,
}));

vi.mock('../../../../src/features/chat/composer/useChatCommandController.js', () => ({
  useChatCommandController: () => composerHarness.command,
}));

vi.mock('../../../../src/features/chat/composer/useChatComposerModeController.js', () => ({
  useChatComposerModeController: () => composerHarness.mode,
}));

vi.mock('../../../../src/features/chat/composer/useQueuedTurnComposerEdit.js', () => ({
  useQueuedTurnComposerEdit: () => composerHarness.queuedEdit,
}));

describe('ChatComposer view state characterization', () => {
  it('consumes an explicit focus request only after focusing an available editor', () => {
    const focus = vi.fn();
    const consume = vi.fn();

    applyChatComposerFocusRequest(null, false, 3, consume);
    expect(consume).not.toHaveBeenCalled();

    applyChatComposerFocusRequest({ focus }, false, 3, consume);
    expect(focus).toHaveBeenCalledWith({ cursor: 'end', preventScroll: true });
    expect(consume).toHaveBeenCalledWith(3);

    applyChatComposerFocusRequest({ focus }, true, 0, consume);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    composerHarness.attachments = {
      addExistingImage: vi.fn(),
      addFiles: vi.fn(),
      atLimit: false,
      beginSend: vi.fn(),
      busy: false,
      clear: vi.fn(),
      items: [],
      remove: vi.fn(),
      replaceWithExisting: vi.fn(),
      sendableAttachments: [],
      settleSend: vi.fn(),
    };
    composerHarness.command = {
      acceptMentionSelection: vi.fn(),
      acceptSlashSelection: vi.fn(),
      activeMentionIndex: 0,
      activeSlashIndex: 0,
      clearSlashDismissal: vi.fn(),
      closeSlashMenu: vi.fn(),
      commandCursorOffset: 0,
      entries: [],
      focusComposer: vi.fn(),
      forcedSlashMenuOpen: false,
      handleComposerBlur: vi.fn(),
      handleComposerFocus: vi.fn(),
      handleDraftValueChange: vi.fn(),
      handleMentionKeyDown: vi.fn(),
      handleSlashKeyDown: vi.fn(),
      loadError: null,
      loading: false,
      mentionCommand: null,
      mentionMenuOpen: false,
      setActiveMentionIndex: vi.fn(),
      setActiveSlashIndex: vi.fn(),
      slashCommand: null,
      slashMenuOpen: false,
      slashQuery: '',
      toggleSlashMenu: vi.fn(),
      updateCursorOffset: vi.fn(),
    };
    composerHarness.mode = {
      activeModelName: 'Test model',
      clearGoalMode: vi.fn(),
      closeUsagePanel: vi.fn(),
      createSendOptions: vi.fn(() => ({})),
      disablePlanMode: vi.fn(),
      goalEnabled: false,
      goalModeEnabled: false,
      hasProtectedModeState: false,
      modelOpenSignal: 0,
      openModelPicker: vi.fn(),
      planModeEnabled: false,
      resetAfterSend: vi.fn(),
      setThinkingEffort: vi.fn(),
      setThinkingEnabled: vi.fn(),
      setThinkingMenuOpen: vi.fn(),
      supportsImageInput: true,
      thinkingConfig: {
        defaultEffort: '',
        efforts: [],
        supported: false,
      },
      thinkingEffort: '',
      thinkingEnabled: false,
      thinkingMenuOpen: false,
      toggleGoalMode: vi.fn(),
      togglePlanMode: vi.fn(),
      toggleUsagePanel: vi.fn(),
      usagePanelOpen: false,
    };
    composerHarness.queuedEdit = {
      cancel: vi.fn(),
      edit: vi.fn(),
      editDisabled: false,
      editing: false,
      retrieving: false,
      submit: vi.fn(),
      visibleQueuedTurnInputs: [],
    };
  });

  it('preserves the primary action precedence across idle, running and attachment-only states', () => {
    expect(renderComposer()).toContain('data-action="sender-default"');

    const running = renderComposer({ activeTurnId: 'turn-1' });
    expect(running).toContain('aria-label="chat.composer.stop"');
    expect(running).not.toContain('aria-label="chat.composer.queue"');

    const queued = renderComposer({ activeTurnId: 'turn-1', draft: 'next request' });
    expect(queued).toContain('aria-label="chat.composer.queue"');
    expect(queued).not.toContain('aria-label="chat.composer.stop"');

    composerHarness.attachments.sendableAttachments = [readyAttachment()];
    const attachmentOnly = renderComposer();
    expect(attachmentOnly).toContain('aria-label="chat.composer.send"');
    expect(attachmentOnly).not.toContain('data-action="sender-default"');
  });

  it('keeps editing, plan, collaboration and goal badges in the footer', () => {
    composerHarness.queuedEdit.editing = true;
    composerHarness.mode.planModeEnabled = true;
    composerHarness.mode.goalEnabled = true;

    const html = renderComposer({
      activeTurnId: 'turn-1',
      config: {
        features: { multi_agent: true },
      } as unknown as RuntimeConfigState,
    });

    expect(html).toContain('chat.queue.editing');
    expect(html).toContain('chat.composer.badge.planNext');
    expect(html).toContain('chat.composer.badge.collaboration');
    expect(html).toContain('chat.composer.badge.goalNext');
  });

  it('renders command overlays independently and gates usage by thread presence', () => {
    composerHarness.command.mentionMenuOpen = true;
    expect(renderComposer()).toContain('data-overlay="mention"');

    composerHarness.command.mentionMenuOpen = false;
    composerHarness.command.slashMenuOpen = true;
    expect(renderComposer()).toContain('data-overlay="slash"');

    composerHarness.mode.usagePanelOpen = true;
    expect(renderComposer()).not.toContain('chat-usage-panel');

    const withThread = renderComposer({
      currentThread: {
        id: 'thread-1',
        queuedTurnInputs: [],
      } as unknown as RuntimeThread,
    });
    expect(withThread).toContain('chat-usage-panel');
    expect(withThread).toContain('chat.usage.total');
  });
});

function renderComposer(overrides: Partial<Parameters<typeof ChatComposer>[0]> = {}): string {
  const queuedTurnActions = {
    deleteQueuedTurnInput: vi.fn(async () => true),
    releaseQueuedTurnInputEdit: vi.fn(async () => true),
    retrieveQueuedTurnInput: vi.fn(async () => null),
    sendQueuedTurnInputNow: vi.fn(async () => true),
    updateQueuedTurnInput: vi.fn(async () => 'updated' as const),
  };

  return renderToStaticMarkup(
    <ChatComposer
      activeTurnId={null}
      canClearContext={false}
      client={{} as DesktopRuntimeClient}
      config={null}
      contextUsage={{
        compactedMessageCount: 0,
        percent: 0,
        totalTokens: 256_000,
        triggerScopes: [],
        usedTokens: 0,
        visiblePercent: 0,
      }}
      currentThread={null}
      draft=""
      queuedTurnActions={queuedTurnActions}
      skills={[]}
      threadUsage={null}
      onAccessModeChange={vi.fn()}
      onCancelActiveTurn={vi.fn()}
      onClearContext={vi.fn()}
      onClearThreadGoal={vi.fn()}
      onCompactContext={vi.fn()}
      onDraftChange={vi.fn()}
      onSearchProjectEntries={vi.fn(async () => ({
        entries: [],
        query: '',
        scanned: 0,
        truncated: false,
        workspaceRoot: '/workspace',
      }))}
      onSelectModel={vi.fn()}
      onSend={vi.fn(async () => true)}
      onSetMultiAgentEnabled={vi.fn()}
      onStartThreadReview={vi.fn()}
      onThreadMemoryModeChange={vi.fn()}
      {...overrides}
    />,
  );
}

function readyAttachment(): RuntimeMessageAttachment {
  return {
    id: 'attachment-1',
    name: 'image.png',
    size: 3,
    source: 'inline',
    type: 'image/png',
    url: 'data:image/png;base64,AAAA',
  };
}
