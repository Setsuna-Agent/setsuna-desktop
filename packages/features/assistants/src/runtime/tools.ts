import { runtimeText, type RuntimeInterfaceLanguage, type RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import {
  identity, isActiveTask, record, text, type Assistant, type AssistantRequestAnswer, type AssistantsRuntimeHost, type AssistantTask,
  type AssistantToolContext,
} from '../contracts/index.js';
import type { AssistantAccess } from './access.js';
import type { AssistantDeliveryOutbox } from './deliveries.js';
import type { AssistantDirectory } from './directory.js';
import { assistantSystemPrompt } from './prompt.js';
import { clip } from './task-reports.js';
import type { AssistantTaskCoordinator } from './tasks.js';
import type { AssistantReminders } from './reminders.js';
import { REMINDER_TOOL_NAME, reminderToolDefinition, runReminderTool } from './reminder-tools.js';

export const ASSISTANT_TOOL_NAMES = [
  'assistant_list_projects', 'assistant_search_history', 'assistant_read_history', 'assistant_dispatch_task',
  'assistant_list_tasks', 'assistant_followup_task', 'assistant_cancel_task', 'assistant_answer_request',
  REMINDER_TOOL_NAME,
] as const;
type AssistantToolName = typeof ASSISTANT_TOOL_NAMES[number];

const SEARCH_LIMIT = 20;
const READ_LIMIT = 30;
const FINISHED_TASKS_IN_LIST = 10;

function optionalInteger(value: unknown, label: string, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error(`${label} must be an integer between 1 and ${maximum}.`);
  return Number(value);
}

function optionalString(value: unknown, label: string, limit: number): string | undefined {
  return value === undefined || value === '' ? undefined : text(value, label, limit);
}

/** Compact task view for the model; omits ledger internals it does not need. */
function taskView(task: AssistantTask) {
  return {
    task_id: task.id, title: task.title, project_id: task.projectId, thread_id: task.workThreadId, status: task.status,
    ...(task.requests.length ? { requests: task.requests } : {}),
    ...(task.result ? { result: clip(task.result, 4_000) } : {}),
    ...(task.error ? { error: task.error } : {}),
    created_at: task.createdAt, ...(task.finishedAt ? { finished_at: task.finishedAt } : {}),
  };
}

/** Orchestration tools; every call resolves its assistant from the conversation and is authorized again. */
export class AssistantTools {
  constructor(
    private readonly host: AssistantsRuntimeHost,
    private readonly directory: AssistantDirectory,
    private readonly access: AssistantAccess,
    private readonly tasks: AssistantTaskCoordinator,
    private readonly outbox: AssistantDeliveryOutbox,
    private readonly reminders: AssistantReminders,
  ) {}

  systemPrompt(threadId: string, language?: RuntimeInterfaceLanguage): string | null {
    const assistant = this.directory.assistantForThread(threadId);
    return assistant ? assistantSystemPrompt(assistant, language) : null;
  }

  definitions(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition[] {
    const t = runtimeText(language);
    const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, required, properties });
    const taskId = { type: 'string', description: t('Task id returned by assistant_dispatch_task or assistant_list_tasks.', 'assistant_dispatch_task 或 assistant_list_tasks 返回的任务 ID。') };
    return [
      reminderToolDefinition(language),
      {
        name: 'assistant_list_projects',
        description: t('List the projects this assistant is authorized to work in.', '列出此助理获得授权的项目。'),
        inputSchema: object({}),
      },
      {
        name: 'assistant_search_history',
        description: t('Search project conversations in authorized projects by title or content. Use it to find work the request may continue.', '在授权项目中按标题或内容检索项目对话，用于判断需求是否属于已有工作。'),
        inputSchema: object({
          project_id: { type: 'string', description: t('Limit to one authorized project.', '只检索一个授权项目。') },
          query: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: SEARCH_LIMIT },
        }),
      },
      {
        name: 'assistant_read_history',
        description: t('Read recent visible messages of a project conversation in an authorized project.', '读取授权项目中某个项目对话最近的可见消息。'),
        inputSchema: object({
          thread_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: READ_LIMIT },
        }, ['thread_id']),
      },
      {
        name: 'assistant_dispatch_task',
        description: t(
          'Start project work in a project conversation that runs independently of this chat. New conversations use the project defaults; thread_id continues an existing one with its own settings. Write tasks in the same checkout queue unless parallel creates a worktree.',
          '在独立于当前聊天的项目对话中开始工作。新对话采用项目默认配置；传入 thread_id 会续接已有对话并保留其配置。同一工作目录的写任务默认排队，parallel 会创建 worktree 并行执行。',
        ),
        inputSchema: object({
          project_id: { type: 'string' },
          title: { type: 'string', maxLength: 120 },
          instructions: { type: 'string', description: t('Self-contained request for the project agent.', '发给项目 agent 的自包含需求。') },
          thread_id: { type: 'string', description: t('Existing project conversation to continue.', '要续接的已有项目对话。') },
          parallel: { type: 'boolean', description: t('Run in a new Git worktree instead of waiting for the workspace.', '在新的 Git worktree 中并行执行，而不是等待工作目录空闲。') },
        }, ['project_id', 'title', 'instructions']),
      },
      {
        name: 'assistant_list_tasks',
        description: t('Show this assistant\'s active and recent tasks, or the latest progress of one task.', '查看此助理进行中和最近的任务，或某个任务的最新进展。'),
        inputSchema: object({ task_id: taskId }),
      },
      {
        name: 'assistant_followup_task',
        description: t('Send additional instructions to a task. Running tasks receive them immediately; finished tasks continue in the same conversation.', '给任务补充指令。运行中的任务会立即收到；已结束的任务会在原对话中继续。'),
        inputSchema: object({ task_id: taskId, message: { type: 'string' } }, ['task_id', 'message']),
      },
      {
        name: 'assistant_cancel_task',
        description: t('Cancel a pending, queued or running task.', '取消等待中、排队中或运行中的任务。'),
        inputSchema: object({ task_id: taskId }, ['task_id']),
      },
      {
        name: 'assistant_answer_request',
        description: t(
          'Answer a task\'s approval or information request with the user\'s reply. Approvals take decision; information requests take action and values keyed by field id.',
          '用用户的答复回应任务的审批或信息请求。审批使用 decision；信息请求使用 action，并以字段 ID 为键填写 values。',
        ),
        inputSchema: object({
          task_id: taskId,
          request_id: { type: 'string' },
          decision: { type: 'string', enum: ['approve', 'approve_for_session', 'reject'] },
          action: { type: 'string', enum: ['submit', 'decline'] },
          values: { type: 'object', description: t('Answers keyed by field id: strings, numbers, booleans or string lists.', '以字段 ID 为键的答案：字符串、数字、布尔值或字符串列表。') },
          message: { type: 'string', description: t('Optional note passed to the project agent.', '可选，转达给项目 agent 的说明。') },
        }, ['task_id', 'request_id']),
      },
    ];
  }

  isToolName(name: string): name is AssistantToolName {
    return (ASSISTANT_TOOL_NAMES as readonly string[]).includes(name);
  }

  async run(name: string, value: unknown, context: AssistantToolContext): Promise<{ content: string; preview?: string }> {
    const assistant = this.directory.assistantForThread(context.threadId);
    if (!assistant || !this.isToolName(name)) throw new Error('Assistant tools are only available in assistant conversations.');
    const input = record(value ?? {});
    const result = await this.execute(name, input, assistant, context);
    return { content: JSON.stringify(result.data), preview: result.preview };
  }

  private async execute(name: AssistantToolName, input: Record<string, unknown>, assistant: Assistant, context: AssistantToolContext): Promise<{ data: unknown; preview: string }> {
    const route = this.outbox.routeForTurn(context.threadId, context.turnId);
    const visibleTasks = this.tasks.tasks(assistant.id).filter((task) => assistant.projectIds.includes(task.projectId));
    const requireVisibleTask = () => {
      const taskId = identity(input.task_id, 'task_id');
      const task = visibleTasks.find((item) => item.id === taskId);
      if (!task) throw new Error('This task is not available to the current assistant.');
      return task;
    };
    switch (name) {
      case REMINDER_TOOL_NAME:
        return runReminderTool(this.reminders, assistant, input, context, this.host.now(), route);
      case 'assistant_list_projects': {
        const projects = await this.access.projects(assistant);
        return { data: { projects: projects.map(({ id, name, git }) => ({ project_id: id, name, git })) }, preview: `${projects.length} 个项目` };
      }
      case 'assistant_search_history': {
        const threads = await this.access.search(assistant, {
          projectId: input.project_id === undefined ? undefined : identity(input.project_id, 'project_id'),
          query: optionalString(input.query, 'query', 200),
          limit: optionalInteger(input.limit, 'limit', SEARCH_LIMIT) ?? 10,
        });
        return {
          data: { conversations: threads.map((thread) => ({ thread_id: thread.id, title: thread.title, project_id: thread.projectId, updated_at: thread.updatedAt })) },
          preview: `${threads.length} 个对话`,
        };
      }
      case 'assistant_read_history': {
        const { thread, messages } = await this.access.read(assistant, identity(input.thread_id, 'thread_id'), optionalInteger(input.limit, 'limit', READ_LIMIT) ?? 12);
        return {
          data: { thread_id: thread.id, title: thread.title, project_id: thread.projectId, messages: messages.map((message) => ({ ...message, content: clip(message.content, 4_000) })) },
          preview: thread.title,
        };
      }
      case 'assistant_dispatch_task': {
        const task = await this.tasks.dispatch(assistant, {
          threadId: context.threadId,
          ...(context.turnId ? { turnId: context.turnId } : {}),
          ...(route ? { peer: route.peer, ...(route.messageId ? { messageId: route.messageId } : {}), ...(route.initiator ? { initiator: route.initiator } : {}) } : {}),
        }, {
          projectId: identity(input.project_id, 'project_id'),
          title: text(input.title, 'title', 120),
          instructions: text(input.instructions, 'instructions', 32_000),
          ...(input.thread_id === undefined ? {} : { threadId: identity(input.thread_id, 'thread_id') }),
          ...(input.parallel === true ? { parallel: true } : {}),
        });
        return { data: { task: taskView(task), note: 'Progress, questions and results will arrive as mailbox reports.' }, preview: task.title };
      }
      case 'assistant_list_tasks': {
        const tasks = visibleTasks;
        if (input.task_id !== undefined) {
          const task = requireVisibleTask();
          await this.access.thread(assistant, task.workThreadId, task.projectId);
          // Latest visible output of the project conversation is the evidence for progress questions.
          const latest = (await this.host.readThreadMessages(task.workThreadId, 6)).filter((message) => message.role === 'assistant').at(-1);
          return { data: { task: taskView(task), ...(latest ? { latest_message: clip(latest.content, 3_000) } : {}) }, preview: task.title };
        }
        const active = tasks.filter(isActiveTask);
        const finished = tasks.filter((task) => !isActiveTask(task))
          .sort((left, right) => (right.finishedAt ?? '').localeCompare(left.finishedAt ?? '')).slice(0, FINISHED_TASKS_IN_LIST);
        return { data: { active: active.map(taskView), recent: finished.map(taskView) }, preview: `${active.length} 个进行中` };
      }
      case 'assistant_followup_task': {
        requireVisibleTask();
        const task = await this.tasks.followup(assistant, identity(input.task_id, 'task_id'), text(input.message, 'message', 32_000));
        return { data: { task: taskView(task) }, preview: task.title };
      }
      case 'assistant_cancel_task': {
        requireVisibleTask();
        const task = await this.tasks.cancel(assistant, identity(input.task_id, 'task_id'));
        return { data: { task: taskView(task) }, preview: task.title };
      }
      case 'assistant_answer_request': {
        requireVisibleTask();
        await this.tasks.answer(assistant, identity(input.task_id, 'task_id'), identity(input.request_id, 'request_id'), requestAnswer(input));
        return { data: { answered: true }, preview: '已转达答复' };
      }
    }
  }
}

function requestAnswer(input: Record<string, unknown>): AssistantRequestAnswer {
  const decision = input.decision;
  const action = input.action;
  if (decision !== undefined && decision !== 'approve' && decision !== 'approve_for_session' && decision !== 'reject') throw new Error('Invalid decision.');
  if (action !== undefined && action !== 'submit' && action !== 'decline') throw new Error('Invalid action.');
  const values = input.values === undefined ? undefined : record(input.values);
  for (const item of Object.values(values ?? {})) {
    const valid = ['string', 'number', 'boolean'].includes(typeof item) || (Array.isArray(item) && item.every((entry) => typeof entry === 'string'));
    if (!valid) throw new Error('values must contain strings, numbers, booleans or string lists.');
  }
  return {
    ...(decision ? { decision } : {}), ...(action ? { action } : {}),
    ...(values ? { values: values as AssistantRequestAnswer['values'] } : {}),
    ...(input.message === undefined ? {} : { message: text(input.message, 'message', 4_000) }),
  };
}
