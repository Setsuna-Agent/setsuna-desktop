import type { RuntimeMessage, RuntimeReviewModeNotice, RuntimeSkillReference, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
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

function renderAssistantMessage(
  segments: RuntimeMessage[],
  active = false,
  reviewExit?: RuntimeReviewModeNotice,
): string {
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
        reviewExit,
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

  it('marks Review inputs distinctly without offering message editing', () => {
    const reviewHtml = renderUserMessage(
      'review',
      false,
      '请审查当前项目中尚未提交的代码更改',
    );

    expect(reviewHtml).toContain('chat-user-message-kind--review');
    expect(reviewHtml).toContain('审查');
    expect(reviewHtml).toContain('请审查当前项目中尚未提交的代码更改');
    expect(reviewHtml).not.toContain('aria-label="编辑"');
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

    expect(selectedHtml).toContain('class="chat-inline-reference chat-skill-reference"');
    expect(selectedHtml).toContain('data-skill-icon="skill"');
    expect(selectedHtml).toMatch(/chat-user-message-content__body"><span class="chat-inline-reference chat-skill-reference"[^>]*>.*对话创建Skill<\/span><\/span> 你看下这个 skill<\/span>/u);
    expect(plainHtml).not.toContain('chat-skill-reference');
  });

  it('uses the owning Plugin icon for a Plugin Skill reference', () => {
    const visionSkill: RuntimeSkillSummary = {
      id: 'openai-vision-recognition.vision-recognition',
      name: '视觉识别',
      icon: 'vision-recognition',
      kind: 'plugin',
      enabled: true,
      selected: false,
      pluginId: 'openai-vision-recognition',
    };
    const html = renderUserMessage('message', false, '视觉识别 看下图片', {
      skillReferences: [{ skillId: visionSkill.id, start: 0, end: visionSkill.name.length }],
      skills: [visionSkill],
    });

    expect(html).toContain('data-plugin-icon="vision-recognition"');
    expect(html).toContain('desktop-plugin-icon--inline');
    expect(html).not.toContain('data-skill-icon="skill"');
  });

  it('renders the historical serialized Skill label after the Skill is renamed', () => {
    const html = renderUserMessage('message', false, '对话创建Skill 历史消息', {
      skillReferences: [{ skillId: skillCreator.id, start: 0, end: skillCreator.name.length }],
      skills: [{ ...skillCreator, name: '新的 Skill 名称' }],
    });

    expect(html).toContain('class="chat-inline-reference chat-skill-reference"');
    expect(html).toContain('对话创建Skill');
    expect(html).not.toContain('新的 Skill 名称');
  });

  it('keeps a read-only historical Skill reference after the Skill is deleted', () => {
    const html = renderUserMessage('message', false, '对话创建Skill 历史消息', {
      skillReferences: [{ skillId: skillCreator.id, start: 0, end: skillCreator.name.length }],
      skills: [],
    });

    expect(html).toContain('class="chat-inline-reference chat-skill-reference"');
    expect(html).toContain('data-skill-icon="skill"');
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
  it('replaces completed review prose with a compact findings card', () => {
    const review = [
      '发现 1 个需要修复的问题。',
      '[P1] 复制不能吞掉换行 — apps/desktop/renderer/src/chat.ts:211',
      '这段详细说明只应该出现在 diff 行内。',
    ].join('\n');
    const html = renderAssistantMessage([{
      id: 'assistant_review',
      turnId: 'turn_review',
      role: 'assistant',
      content: review,
      createdAt: '2026-08-12T00:00:00.000Z',
      status: 'complete',
      phase: 'final_answer',
    }], false, {
      kind: 'exited',
      review,
      summary: '发现 1 个需要修复的问题。',
      findings: [{
        priority: 'P1',
        title: '复制不能吞掉换行',
        body: '这段详细说明只应该出现在 diff 行内。',
        path: 'apps/desktop/renderer/src/chat.ts',
        startLine: 211,
      }],
    });

    expect(html).toContain('chat-review-summary-card');
    expect(html).toContain('1 条评论');
    expect(html).toContain('复制不能吞掉换行');
    expect(html).not.toContain('apps/desktop/renderer/src/chat.ts:211');
    expect(html).not.toContain('这段详细说明只应该出现在 diff 行内。');
  });

  it('does not render an empty comments panel when review has no findings', () => {
    const review = '本轮未发现需要修复的问题。';
    const html = renderAssistantMessage([{
      id: 'assistant_review_empty',
      turnId: 'turn_review_empty',
      role: 'assistant',
      content: review,
      createdAt: '2026-08-12T00:00:00.000Z',
      status: 'complete',
      phase: 'final_answer',
    }], false, {
      kind: 'exited',
      review,
    });

    expect(html).toContain('本轮未发现需要修复的问题。');
    expect(html).not.toContain('chat-review-summary-card__panel');
    expect(html).not.toContain('0 条评论');
  });

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

  it('renders work that follows committed content below that content', () => {
    const html = renderAssistantMessage([
      {
        id: 'assistant_body',
        turnId: 'turn_order',
        role: 'assistant',
        content: '已经输出的正文。',
        createdAt: '2026-08-11T00:00:00.000Z',
        status: 'complete',
        phase: 'final_answer',
      },
      {
        id: 'assistant_followup',
        turnId: 'turn_order',
        role: 'assistant',
        content: '我继续核对后续状态。<think>继续检查',
        createdAt: '2026-08-11T00:00:01.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'read_followup', name: 'workspace_read_file', status: 'running' }],
      },
    ], true);
    const contentIndex = html.indexOf('已经输出的正文。');
    const laterWorkIndex = html.indexOf('chat-work-history', contentIndex);
    const commentaryIndex = html.indexOf('我继续核对后续状态。', contentIndex);

    expect(contentIndex).toBeGreaterThanOrEqual(0);
    expect(laterWorkIndex).toBeGreaterThan(contentIndex);
    expect(commentaryIndex).toBeGreaterThan(contentIndex);
  });

  it('keeps the preamble visible while adjacent tools share the work panel', () => {
    const html = renderAssistantMessage([
      {
        id: 'assistant_status',
        turnId: 'turn_compact',
        role: 'assistant',
        content: '我先看一下工作区的改动概况。',
        createdAt: '2026-08-11T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{ id: 'git_status', name: 'git_status', status: 'success' }],
      },
      {
        id: 'assistant_diff',
        turnId: 'turn_compact',
        role: 'assistant',
        content: '',
        createdAt: '2026-08-11T00:00:01.000Z',
        status: 'streaming',
        phase: 'commentary',
        toolRuns: [{ id: 'read_diff', name: 'workspace_read_file', status: 'running' }],
      },
    ], true);

    expect(html).toContain('chat-work-history');
    expect(html).toContain('我先看一下工作区的改动概况。');
    expect(html).toContain('正在查看文件/目录');
  });
});
