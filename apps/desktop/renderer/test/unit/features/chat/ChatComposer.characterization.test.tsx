// @vitest-environment happy-dom

import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeMessageAttachment,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyChatComposerFocusRequest,
  ChatComposer,
  composerActiveTurn,
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
    onSubmit,
    placeholder,
  }: {
    footer?: (actions: React.ReactNode) => React.ReactNode;
    header?: React.ReactNode;
    onSubmit?: (value?: string) => unknown;
    placeholder?: string;
  }, _ref) => (
    <div data-component="sender" data-placeholder={placeholder}>
      {header}
      {footer?.(<button type="button" data-action="sender-default">default</button>)}
      <button type="button" data-testid="sender-submit" onClick={() => void onSubmit?.()}>submit</button>
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
  ChatModelPicker: ({ onSelect }: {
    onSelect: (providerId: string, modelId: string) => void;
  }) => (
    <button
      type="button"
      data-component="model-picker"
      onClick={() => onSelect('provider-b', 'model-b')}
    >
      select model b
    </button>
  ),
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
  afterEach(cleanup);

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

  it('exposes neutral active turn metadata to composer contributions', () => {
    const thread = {
      turns: [{ id: 'turn-1', items: [], startedAt: '2026-08-10T00:00:00.000Z', taskKind: 'regular' }],
    } as unknown as RuntimeThread;

    expect(composerActiveTurn(thread, 'turn-1')).toEqual({
      startedAt: '2026-08-10T00:00:00.000Z',
      taskKind: 'regular',
    });
    expect(composerActiveTurn(thread, 'turn-2')).toBeUndefined();
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
      clearReviewMode: vi.fn(),
      createSendOptions: vi.fn(() => ({})),
      enableGoalMode: vi.fn(),
      enableReviewMode: vi.fn(),
      goalModeEnabled: false,
      hasProtectedModeState: false,
      modelOpenSignal: 0,
      openModelPicker: vi.fn(),
      resetAfterSend: vi.fn(),
      reviewModeEnabled: false,
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

  it('keeps editing, collaboration and goal badges in the footer', () => {
    composerHarness.queuedEdit.editing = true;
    composerHarness.mode.goalModeEnabled = true;

    const html = renderComposer({
      activeTurnId: 'turn-1',
      config: {
        features: { multi_agent: true },
      } as unknown as RuntimeConfigState,
    });

    expect(html).toContain('chat.queue.editing');
    expect(html).toContain('chat.composer.badge.collaboration');
    expect(html).toContain('chat.composer.badge.goalNext');
  });

  it('renders mention and slash command overlays independently', () => {
    composerHarness.command.mentionMenuOpen = true;
    expect(renderComposer()).toContain('data-overlay="mention"');

    composerHarness.command.mentionMenuOpen = false;
    composerHarness.command.slashMenuOpen = true;
    expect(renderComposer()).toContain('data-overlay="slash"');
  });

  it('adds the local file mention hint only for project conversations', () => {
    expect(renderComposer()).toContain('data-placeholder="chat.composer.placeholder"');

    const activeProject = {
      id: 'project-1',
      name: 'Project',
      path: '/workspace',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    };
    expect(renderComposer({ activeProject }))
      .toContain('data-placeholder="chat.composer.projectPlaceholder"');
    expect(renderComposer({
      activeProject,
      currentThread: {
        id: 'global-thread',
        messages: [],
        projectId: undefined,
        queuedTurnInputs: [],
      } as unknown as RuntimeThread,
    })).toContain('data-placeholder="chat.composer.placeholder"');
    expect(renderComposer({ activeProject, placeholder: 'Custom placeholder' }))
      .toContain('data-placeholder="Custom placeholder"');
  });

  it('carries the composer model selection into a first-turn review', async () => {
    composerHarness.mode.reviewModeEnabled = true;
    const onStartThreadReview = vi.fn(async () => undefined);

    render(composerElement({
      config: modelConfig(),
      draft: 'Review the selected model boundary.',
      onStartThreadReview,
    }));
    fireEvent.click(screen.getByTestId('sender-submit'));

    await waitFor(() => expect(onStartThreadReview).toHaveBeenCalledWith(
      { type: 'custom', instructions: 'Review the selected model boundary.' },
      { providerId: 'provider-a', modelId: 'model-a' },
    ));
  });

  it('shows and sends a newly selected thread model before persistence completes', async () => {
    const onSelectModel = vi.fn(async () => undefined);
    const onSend = vi.fn(async () => true);
    const currentThread = {
      id: 'thread-a',
      messages: [],
      queuedTurnInputs: [],
      modelBinding: {
        providerId: 'provider-a',
        modelId: 'model-a',
        modelCode: 'model-a-code',
      },
    } as unknown as RuntimeThread;

    render(composerElement({
      config: modelConfig(),
      currentThread,
      draft: 'Use the newly selected model.',
      onSelectModel,
      onSend,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'select model b' }));
    expect(onSelectModel).toHaveBeenCalledWith('provider-b', 'model-b', 'thread-a');

    fireEvent.click(screen.getByTestId('sender-submit'));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        modelSelection: { providerId: 'provider-b', modelId: 'model-b' },
      }),
    ));
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

  return renderToStaticMarkup(composerElement(overrides, queuedTurnActions));
}

function composerElement(
  overrides: Partial<Parameters<typeof ChatComposer>[0]> = {},
  queuedTurnActions = {
    deleteQueuedTurnInput: vi.fn(async () => true),
    releaseQueuedTurnInputEdit: vi.fn(async () => true),
    retrieveQueuedTurnInput: vi.fn(async () => null),
    sendQueuedTurnInputNow: vi.fn(async () => true),
    updateQueuedTurnInput: vi.fn(async () => 'updated' as const),
  },
) {
  return (
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
      onAccessModeChange={vi.fn()}
      onCancelActiveTurn={vi.fn()}
      onClearContext={vi.fn()}
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
      {...overrides}
    />
  );
}

function modelConfig(): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/data',
    storagePath: '/tmp/storage',
    activeProviderId: 'provider-a',
    providers: [
      modelProvider('provider-a', 'model-a', 'model-a-code', 'anthropic', true),
      modelProvider('provider-b', 'model-b', 'model-b-code', 'openai-responses', false),
    ],
    globalPrompt: '',
    memory: { useMemories: false, generateMemories: false, disableOnExternalContext: true },
    memoryEnabled: false,
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}

function modelProvider(
  id: string,
  modelId: string,
  code: string,
  provider: 'anthropic' | 'openai-responses',
  selected: boolean,
): RuntimeConfigState['providers'][number] {
  return {
    id,
    name: id,
    provider,
    baseUrl: `https://${id}.example.test`,
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: '***',
    models: [{
      id: modelId,
      name: modelId,
      code,
      enabled: selected,
      maxOutputTokens: 4_096,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  };
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
