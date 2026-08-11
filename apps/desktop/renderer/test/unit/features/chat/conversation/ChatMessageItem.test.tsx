import type { RuntimeMessage, RuntimeSkillReference, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import type { ChatDisplayItem } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';
import type { RuntimePluginUse } from '../../../../../src/features/chat/artifacts/runtimePluginUsage.js';
import { SkillReferenceCatalogProvider } from '../../../../../src/features/chat/skills/SkillReference.js';

function userItem(message: RuntimeMessage): Extract<ChatDisplayItem, { type: 'user' }> {
  return {
    type: 'user',
    id: message.id,
    handledSteerMessageIds: [],
    guidanceProcessed: false,
    message,
    messageIds: [message.id],
    steered: false,
    steerMessages: [],
  };
}

const skillCreator: RuntimeSkillSummary = {
  id: 'skill-creator',
  name: '对话创建Skill',
  kind: 'builtin',
  enabled: true,
  selected: false,
  description: '通过对话创建 Skill',
};

function renderUserMessage(
  inputKind: RuntimeMessage['inputKind'],
  editing = false,
  content = 'Inspect the queue.',
  options: { skillReferences?: RuntimeSkillReference[]; skills?: RuntimeSkillSummary[] } = {},
): string {
  const message: RuntimeMessage = {
    id: `message_${inputKind}`,
    turnId: `turn_${inputKind}`,
    role: 'user',
    inputKind,
    content,
    skillReferences: options.skillReferences,
    createdAt: '2026-07-27T00:00:00.000Z',
    status: 'complete',
  };
  return renderToStaticMarkup(
    <SkillReferenceCatalogProvider skills={options.skills ?? []}>
      <MessageItem
        activeAssistantItemId={null}
        activeTurnId={null}
        assistantItemIdByTurnId={new Map()}
        deleteMode={false}
        editingDraft={editing ? message.content : ''}
        editingMessageId={editing ? message.id : null}
        editingSubmitting={false}
        expandedWorkHistoryItemIds={new Set()}
        item={userItem(message)}
        onAnswerApproval={async () => undefined}
        onCancelEdit={() => undefined}
        onEditDraftChange={() => undefined}
        onStartEdit={() => undefined}
        onStartDelete={() => undefined}
        onSubmitEdit={() => undefined}
        onToggleDelete={() => undefined}
        onWorkHistoryExpandedChange={() => undefined}
        pluginUses={[]}
        selectedForDelete={false}
      />
    </SkillReferenceCatalogProvider>,
  );
}

function renderPlanMessage(pluginUses: RuntimePluginUse[]): string {
  const message: RuntimeMessage = {
    id: 'assistant_plan',
    turnId: 'turn_plan',
    role: 'assistant',
    content: '1. Inspect the current implementation.',
    createdAt: '2026-07-27T00:00:00.000Z',
    status: 'complete',
    planMode: { mode: 'plan', status: 'awaiting_confirmation' },
  };
  return renderToStaticMarkup(
    <MessageItem
      activeAssistantItemId={null}
      activeTurnId={null}
      assistantItemIdByTurnId={new Map()}
      deleteMode={false}
      editingDraft=""
      editingMessageId={null}
      editingSubmitting={false}
      expandedWorkHistoryItemIds={new Set()}
      item={{
        type: 'assistant',
        id: message.id,
        handledSteerMessageIds: [],
        messageIds: [message.id],
        segments: [message],
        steerMessages: [],
        turnId: message.turnId,
      }}
      onAnswerApproval={async () => undefined}
      onCancelEdit={() => undefined}
      onEditDraftChange={() => undefined}
      onStartEdit={() => undefined}
      onStartDelete={() => undefined}
      onSubmitEdit={() => undefined}
      onToggleDelete={() => undefined}
      onWorkHistoryExpandedChange={() => undefined}
      pluginUses={pluginUses}
      selectedForDelete={false}
    />,
  );
}

function renderAssistantMessage(segments: RuntimeMessage[], active = false): string {
  const turnId = segments[0]?.turnId ?? 'turn_assistant';
  return renderToStaticMarkup(
    <MessageItem
      activeAssistantItemId={active ? 'assistant_item' : null}
      activeTurnId={active ? turnId : null}
      assistantItemIdByTurnId={new Map()}
      deleteMode={false}
      editingDraft=""
      editingMessageId={null}
      editingSubmitting={false}
      expandedWorkHistoryItemIds={new Set()}
      item={{
        type: 'assistant',
        id: 'assistant_item',
        handledSteerMessageIds: [],
        messageIds: segments.map((segment) => segment.id),
        segments,
        steerMessages: [],
        turnId,
      }}
      onAnswerApproval={async () => undefined}
      onCancelEdit={() => undefined}
      onEditDraftChange={() => undefined}
      onStartEdit={() => undefined}
      onStartDelete={() => undefined}
      onSubmitEdit={() => undefined}
      onToggleDelete={() => undefined}
      onWorkHistoryExpandedChange={() => undefined}
      pluginUses={[]}
      selectedForDelete={false}
    />,
  );
}

describe('MessageItem user messages', () => {
  it('marks Goal inputs distinctly without offering Goal regeneration', () => {
    const goalHtml = renderUserMessage('goal');

    expect(goalHtml).toContain('chat-user-message-kind--goal');
    expect(goalHtml).toContain('目标');
    expect(goalHtml).not.toContain('aria-label="编辑"');
  });

  it('omits the message timestamp while editing', () => {
    const editorHtml = renderUserMessage('message', true);

    expect(editorHtml).toContain('class="chat-user-edit"');
    expect(editorHtml).not.toContain('<time');
  });

  it('keeps workspace mentions inline with the surrounding message text', () => {
    const html = renderUserMessage('message', false, '请看 @agent-pc/ 以及 @agent-mobile/ 现在处理');

    expect(html).toContain('class="chat-user-message-content__body"');
    expect(html).toMatch(/chat-user-message-content__body">请看 .*agent-pc\/.* 以及 .*agent-mobile\/.* 现在处理<\/span>/u);
  });

  it('renders selected Skill references inline while leaving matching ordinary text plain', () => {
    const selectedHtml = renderUserMessage(
      'message',
      false,
      '对话创建Skill 你看下这个 skill',
      {
        skillReferences: [{ skillId: skillCreator.id, start: 0, end: skillCreator.name.length }],
        skills: [skillCreator],
      },
    );
    const plainHtml = renderUserMessage(
      'message',
      false,
      '对话创建Skill 只是普通文字',
      { skills: [skillCreator] },
    );

    expect(selectedHtml).toContain('class="chat-skill-reference"');
    expect(selectedHtml).toContain('chat-capability-reference-icon');
    expect(selectedHtml).toMatch(/chat-user-message-content__body"><span class="chat-skill-reference"[^>]*>.*对话创建Skill<\/span><\/span> 你看下这个 skill<\/span>/u);
    expect(plainHtml).not.toContain('chat-skill-reference');
  });

  it('renders the historical serialized Skill label after the Skill is renamed', () => {
    const html = renderUserMessage('message', false, '对话创建Skill 历史消息', {
      skillReferences: [{ skillId: skillCreator.id, start: 0, end: skillCreator.name.length }],
      skills: [{ ...skillCreator, name: '新的 Skill 名称' }],
    });

    expect(html).toContain('class="chat-skill-reference"');
    expect(html).toContain('对话创建Skill');
    expect(html).not.toContain('新的 Skill 名称');
  });

  it('keeps a read-only historical Skill reference after the Skill is deleted', () => {
    const html = renderUserMessage('message', false, '对话创建Skill 历史消息', {
      skillReferences: [{ skillId: skillCreator.id, start: 0, end: skillCreator.name.length }],
      skills: [],
    });

    expect(html).toContain('class="chat-skill-reference"');
    expect(html).toContain('chat-capability-reference-icon');
    expect(html).toContain('对话创建Skill');
  });

  it('renders legacy Plan messages read-only with Plugin attribution', () => {
    const html = renderPlanMessage([{
      id: 'vision-recognition',
      installed: true,
      name: '视觉识别',
    }]);

    expect(html).toContain('已使用插件');
    expect(html).toContain('视觉识别');
    expect(html).toContain('chat-plan-card');
    expect(html).toContain('计划模式已移除');
    expect(html).not.toContain('chat-plan-card__actions');
  });
});

describe('MessageItem assistant tool history', () => {
  it('keeps a completed tool summary stable when later answer content appears', () => {
    const toolSegment: RuntimeMessage = {
      id: 'assistant_tools',
      turnId: 'turn_tools',
      role: 'assistant',
      content: '',
      createdAt: '2026-08-11T00:00:00.000Z',
      status: 'complete',
      toolRuns: [
        {
          id: 'read_package',
          name: 'workspace_read_file',
          status: 'success',
          argumentsPreview: '{"path":"package.json"}',
        },
        {
          id: 'git_log',
          name: 'exec_command',
          status: 'success',
          argumentsPreview: '{"cmd":"git log -1"}',
        },
      ],
    };
    const finalSegment: RuntimeMessage = {
      id: 'assistant_final',
      turnId: 'turn_tools',
      role: 'assistant',
      content: '检查完成。',
      createdAt: '2026-08-11T00:00:01.000Z',
      status: 'streaming',
    };
    const expectedSummary = '已读取 1 个文件，已运行 1 条命令';

    expect(renderAssistantMessage([toolSegment])).toContain(expectedSummary);
    expect(renderAssistantMessage([toolSegment, finalSegment], true)).toContain(expectedSummary);
  });
});
