import type { RuntimeCollaborationTask, RuntimeMessage, RuntimeReviewModeNotice, RuntimeSkillReference, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Window } from 'happy-dom';
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
    assistantTimelineSteerMessageIds: [],
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
  description: '通过对话创建 Skill',
};

function renderUserMessage(
  inputKind: RuntimeMessage['inputKind'],
  editing = false,
  content = 'Inspect the queue.',
  options: {
    item?: Partial<Extract<ChatDisplayItem, { type: 'user' }>>;
    readOnly?: boolean;
    skillReferences?: RuntimeSkillReference[];
    skills?: RuntimeSkillSummary[];
  } = {},
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
  const mutationHandlers = options.readOnly
    ? {}
    : {
        onStartEdit: () => undefined,
        onStartDelete: () => undefined,
        onSubmitEdit: () => undefined,
        onToggleDelete: () => undefined,
      };
  return renderToStaticMarkup(
    <SkillReferenceCatalogProvider skills={options.skills ?? []}>
      <MessageItem
        {...mutationHandlers}
        activeAssistantItemId={null}
        activeTurnId={null}
        assistantItemIdByTurnId={new Map()}
        deleteMode={false}
        editingDraft={editing ? message.content : ''}
        editingMessageId={editing ? message.id : null}
        editingSubmitting={false}
        expandedWorkHistoryItemIds={new Set()}
        item={{ ...userItem(message), ...options.item }}
        onAnswerApproval={async () => undefined}
        onCancelEdit={() => undefined}
        onEditDraftChange={() => undefined}
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
  showThinkingInTranscript = false,
  collaborationTasks?: RuntimeCollaborationTask[],
): string {
  const turnId = segments[0]?.turnId ?? 'turn_assistant';
  return renderToStaticMarkup(
    <MessageItem
      activeAssistantItemId={active ? 'assistant_item' : null}
      activeTurnId={active ? turnId : null}
      assistantItemIdByTurnId={new Map()}
      collaborationTasks={collaborationTasks}
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
      showThinkingInTranscript={showThinkingInTranscript}
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

  it('omits edit and delete actions when mutation handlers are not provided', () => {
    const readOnlyHtml = renderUserMessage('message', false, 'Delegated prompt', {
      readOnly: true,
    });

    expect(readOnlyHtml).toContain('Delegated prompt');
    expect(readOnlyHtml).toContain('aria-label="复制"');
    expect(readOnlyHtml).not.toContain('aria-label="编辑"');
    expect(readOnlyHtml).not.toContain('aria-label="删除"');
  });

  it('omits the message timestamp while editing', () => {
    const editorHtml = renderUserMessage('message', true);

    expect(editorHtml).toContain('class="chat-user-edit"');
    expect(editorHtml).not.toContain('<time');
  });

  it('does not duplicate handled guidance above the assistant timeline', () => {
    const guidance: RuntimeMessage = {
      id: 'user_steer',
      turnId: 'turn_message',
      role: 'user',
      content: 'extra guidance',
      createdAt: '2026-07-27T00:00:01.000Z',
      status: 'complete',
    };
    const html = renderUserMessage('message', false, 'initial prompt', {
      item: {
        guidanceProcessed: true,
        handledSteerMessageIds: [guidance.id],
        messageIds: ['message_message', guidance.id],
        steerMessages: [guidance],
      },
    });

    expect(html).toContain('initial prompt');
    expect(html).not.toContain('extra guidance');
  });

  it('does not duplicate unhandled guidance already owned by the assistant timeline', () => {
    const guidance: RuntimeMessage = {
      id: 'user_steer',
      turnId: 'turn_message',
      role: 'user',
      content: 'late extra guidance',
      createdAt: '2026-07-27T00:00:01.000Z',
      status: 'complete',
    };
    const html = renderUserMessage('message', false, 'initial prompt', {
      item: {
        assistantTimelineSteerMessageIds: [guidance.id],
        guidanceProcessed: false,
        messageIds: ['message_message', guidance.id],
        steerMessages: [guidance],
      },
    });

    expect(html).toContain('initial prompt');
    expect(html).not.toContain('late extra guidance');
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
  it('nests thinking that follows a tool batch inside the tool disclosure', () => {
    const html = renderAssistantMessage([
      {
        id: 'assistant_inspection_tools',
        turnId: 'turn_nested_tool_thinking',
        role: 'assistant',
        content: '',
        createdAt: '2026-08-18T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [
          {
            id: 'read_main',
            name: 'workspace_read_file',
            status: 'success',
            argumentsPreview: '{"path":"src/main.tsx"}',
          },
          {
            id: 'list_src',
            name: 'workspace_list_directory',
            status: 'success',
            argumentsPreview: '{"path":"src"}',
          },
        ],
      },
      {
        id: 'assistant_after_inspection_thinking',
        turnId: 'turn_nested_tool_thinking',
        role: 'assistant',
        content: 'Now inspect how these files connect.',
        streamParts: [{ type: 'reasoning', content: 'Now inspect how these files connect.' }],
        createdAt: '2026-08-18T00:00:01.000Z',
        status: 'complete',
        phase: 'commentary',
      },
    ], true, undefined, true);
    const document = new Window().document;
    document.body.innerHTML = html;
    const thinking = document.querySelector('.chat-thinking-disclosure');
    const toolDisclosure = thinking?.closest('details.chat-tool-run');

    expect(thinking).not.toBeNull();
    expect(toolDisclosure).not.toBeNull();
    expect(toolDisclosure?.querySelector(':scope > summary.chat-tool-run__summary')).not.toBeNull();
  });

  it('keeps active thinking visible outside the preceding tool disclosure', () => {
    const html = renderAssistantMessage([
      {
        id: 'assistant_active_tools',
        turnId: 'turn_active_tool_thinking',
        role: 'assistant',
        content: '',
        createdAt: '2026-08-18T00:00:00.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{
          id: 'read_active_file',
          name: 'workspace_read_file',
          status: 'success',
          argumentsPreview: '{"path":"src/main.tsx"}',
        }],
      },
      {
        id: 'assistant_active_thinking',
        turnId: 'turn_active_tool_thinking',
        role: 'assistant',
        content: 'Still thinking about the result.',
        streamParts: [{ type: 'reasoning', content: 'Still thinking about the result.' }],
        createdAt: '2026-08-18T00:00:01.000Z',
        status: 'streaming',
        phase: 'commentary',
      },
    ], true, undefined, true);
    const document = new Window().document;
    document.body.innerHTML = html;
    const thinking = document.querySelector('.chat-thinking-disclosure.is-active');

    expect(thinking).not.toBeNull();
    expect(thinking?.closest('details.chat-tool-run')).toBeNull();
  });

  it('keeps subagent task cards in flow and visible when the single work history collapses', () => {
    const collaborationTasks: RuntimeCollaborationTask[] = [{
      id: 'task_runtime',
      childThreadId: 'child_runtime',
      title: 'Runtime explorer',
      objective: 'Inspect the runtime architecture.',
      identity: { displayName: 'runtime-explorer', avatarSeed: 'runtime-seed' },
      status: 'running',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:01.000Z',
    }];
    const toolSegment: RuntimeMessage = {
      id: 'assistant_collaboration_tools',
      turnId: 'turn_collaboration_tools',
      role: 'assistant',
      content: '',
      createdAt: '2026-08-21T00:00:00.000Z',
      status: 'complete',
      phase: 'commentary',
      toolRuns: [
        {
          id: 'read_before_spawn',
          name: 'workspace_read_file',
          status: 'success',
          argumentsPreview: '{"path":"packages/contracts/README.md"}',
        },
        {
          id: 'spawn_runtime',
          name: 'spawn_agent',
          status: 'success',
          data: { childThreadId: 'child_runtime' },
        },
        {
          id: 'read_after_spawn',
          name: 'workspace_read_file',
          status: 'success',
          argumentsPreview: '{"path":"packages/desktop-runtime/README.md"}',
        },
      ],
    };
    const finalSegment: RuntimeMessage = {
      id: 'assistant_collaboration_answer',
      turnId: 'turn_collaboration_tools',
      role: 'assistant',
      content: '继续检查其余模块。',
      createdAt: '2026-08-21T00:00:01.000Z',
      status: 'complete',
      phase: 'final_answer',
    };
    const expandedHtml = renderAssistantMessage([toolSegment], true, undefined, false, collaborationTasks);
    const expandedDocument = new Window().document;
    expandedDocument.body.innerHTML = expandedHtml;
    const expandedHistory = expandedDocument.querySelector('.chat-work-history');
    const expandedBodyChildren = [...(expandedHistory?.querySelector('.chat-work-history__body')?.children ?? [])];
    const expandedCard = expandedHistory?.querySelector('.subagent-task-card') ?? null;
    const expandedCardIndex = expandedCard ? expandedBodyChildren.indexOf(expandedCard) : -1;
    const toolRunIndexes = expandedBodyChildren
      .map((element, index) => element.classList.contains('chat-tool-runs') ? index : -1)
      .filter((index) => index >= 0);

    expect(expandedDocument.querySelectorAll('.chat-work-history')).toHaveLength(1);
    expect(expandedHistory?.querySelector('.chat-work-history__summary')?.getAttribute('aria-expanded')).toBe('true');
    expect(toolRunIndexes).toHaveLength(2);
    expect(toolRunIndexes[0]).toBeLessThan(expandedCardIndex);
    expect(expandedCardIndex).toBeLessThan(toolRunIndexes[1]!);

    const html = renderAssistantMessage([toolSegment, finalSegment], false, undefined, false, collaborationTasks);
    const document = new Window().document;
    document.body.innerHTML = html;
    const card = document.querySelector('.subagent-task-card');
    const workHistory = document.querySelector('.chat-work-history');

    expect(document.querySelectorAll('.chat-work-history')).toHaveLength(1);
    expect(workHistory?.querySelector('.chat-work-history__summary')?.getAttribute('aria-expanded')).toBe('false');
    expect(card).not.toBeNull();
    expect(card?.closest('details.chat-tool-run')).toBeNull();
    expect(workHistory?.querySelectorAll('.chat-tool-runs')).toHaveLength(0);
  });

  it('renders structured reasoning only inside the collapsed thinking disclosure', () => {
    const reasoning = 'after: inspect "before<think>private</think>after", then continue private analysis';
    const html = renderAssistantMessage([{
      id: 'assistant_nested_thinking',
      turnId: 'turn_nested_thinking',
      role: 'assistant',
      content: 'Visible answer.',
      streamParts: [
        { type: 'reasoning', content: reasoning },
        { type: 'content', content: 'Visible answer.' },
        { type: 'reasoning', content: reasoning },
      ],
      createdAt: '2026-08-15T00:00:00.000Z',
      status: 'streaming',
    }], true);

    expect(html).toContain('chat-thinking-disclosure');
    expect(html).toContain('正在思考');
    expect(html).toContain('Visible answer.');
    expect(html).not.toContain(reasoning);
    expect(html).not.toContain('chat-assistant-loading');
  });

  it('renders completed structured content without falling back to mixed raw text', () => {
    const reasoning = 'private completed reasoning';
    const html = renderAssistantMessage([{
      id: 'assistant_completed_reasoning',
      turnId: 'turn_completed_reasoning',
      role: 'assistant',
      content: `<think>${reasoning}</think>Visible answer.`,
      streamParts: [
        { type: 'reasoning', content: reasoning },
        { type: 'content', content: 'Visible answer.' },
      ],
      phase: 'final_answer',
      createdAt: '2026-08-15T00:00:00.000Z',
      status: 'complete',
    }]);

    expect(html).toContain('Visible answer.');
    expect(html).not.toContain(reasoning);
  });

  it('retains completed reasoning inside the compressed work record when enabled', () => {
    const reasoning = 'completed reasoning retained by preference';
    const html = renderAssistantMessage([{
      id: 'assistant_completed_reasoning',
      turnId: 'turn_completed_reasoning',
      role: 'assistant',
      content: 'Visible answer.',
      streamParts: [
        { type: 'reasoning', content: reasoning },
        { type: 'content', content: 'Visible answer.' },
      ],
      phase: 'final_answer',
      createdAt: '2026-08-15T00:00:00.000Z',
      status: 'complete',
    }], false, undefined, true);

    expect(html).toContain('chat-work-history');
    expect(html).toContain('已处理');
    expect(html).not.toContain('工作中');
    expect(html).not.toContain('chat-thinking-disclosure');
    expect(html).not.toContain(reasoning);
    expect(html).toContain('Visible answer.');
  });

  it('shows an explicit notice for a completed hidden-only final response', () => {
    const html = renderAssistantMessage([{
      id: 'assistant_hidden_final',
      turnId: 'turn_hidden_final',
      role: 'assistant',
      content: '<think>private unfinished reasoning',
      phase: 'final_answer',
      createdAt: '2026-07-27T00:00:00.000Z',
      status: 'complete',
    }]);

    expect(html).toContain('模型未返回可显示的最终答复');
    expect(html).not.toContain('private unfinished reasoning');
  });

  it('replaces completed review prose with a compact findings card', () => {
    const review = [
      '发现 1 个需要修复的问题。',
      '**[P1] 复制不能吞掉换行 — [chat.ts:211](apps/desktop/renderer/src/chat.ts:211)**',
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
      // Older runtimes persisted only the raw review when their parser missed linked locations.
      summary: review,
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

  it('collapses completed work between visible answer sections while the turn continues', () => {
    const html = renderAssistantMessage([
      {
        id: 'assistant_answer_before',
        turnId: 'turn_interleaved_work',
        role: 'assistant',
        content: '前一段正文。',
        createdAt: '2026-08-11T00:00:00.000Z',
        status: 'complete',
        phase: 'final_answer',
      },
      {
        id: 'assistant_work_between',
        turnId: 'turn_interleaved_work',
        role: 'assistant',
        content: '',
        streamParts: [{ type: 'reasoning', content: '中间思考。' }],
        createdAt: '2026-08-11T00:00:01.000Z',
        status: 'complete',
        phase: 'commentary',
        toolRuns: [{ id: 'read_between', name: 'workspace_read_file', status: 'success' }],
      },
      {
        id: 'assistant_answer_after',
        turnId: 'turn_interleaved_work',
        role: 'assistant',
        content: '后一段正文。',
        createdAt: '2026-08-11T00:00:02.000Z',
        status: 'complete',
        phase: 'final_answer',
      },
    ], true, undefined, true);

    expect(html).toContain('前一段正文。');
    expect(html).toContain('后一段正文。');
    expect(html).toContain('chat-work-history__chevron');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('工作中');
    expect(html).not.toContain('已处理');
    expect(html).not.toContain('中间思考。');
    expect(html).not.toContain('已读取');
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
