import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { automationDraftCodec, identity, record, type AutomationToolService } from '../contracts/index.js';
import type { AutomationService } from './service.js';

export class AutomationTools implements AutomationToolService {
  constructor(private readonly service: AutomationService, private readonly now: () => Date) {}
  startScheduler(): void { this.service.start(); }
  pendingMutationCount(): number { return this.service.pendingMutationCount(); }
  setMaintenancePaused(paused: boolean): void { this.service.setMaintenancePaused(paused); }

  listTools(): RuntimeToolDefinition[] {
    return [{
      name: 'manage_automation',
      description: '创建、查询、编辑、暂停、恢复、删除或立即运行本机定时任务。任务触发时以完全访问权限运行无人值守对话，不向用户请求表单。',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['mode'],
        properties: {
          mode: { type: 'string', enum: ['list', 'create', 'update', 'pause', 'resume', 'delete', 'run'] },
          task_id: { type: 'string', description: '编辑或操作现有任务时必填；使用 list 返回的真实 ID。' },
          title: { type: 'string', maxLength: 120 },
          prompt: { type: 'string', description: '执行任务时发送给 agent 的完整、自包含任务内容。' },
          schedule: {
            type: 'object', additionalProperties: false, required: ['kind'],
            properties: {
              kind: { type: 'string', enum: ['once', 'interval', 'daily', 'weekdays', 'weekly', 'custom'] },
              at: { type: 'string', description: 'once：本机执行时间所对应的 ISO 日期时间。' },
              minutes: { type: 'integer', minimum: 1, description: 'interval：间隔分钟。' },
              time: { type: 'string', description: '日历重复规则的本机 HH:mm 时间。' },
              weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'weekly 选一天，custom 选多天；0 为周日。' },
            },
          },
          new_chat: { type: 'boolean', description: '每次运行是否新建对话，默认 false。' },
          project_id: { type: ['string', 'null'], description: '执行对话所属项目，使用可用项目的真实 ID；null 放到普通对话。创建时省略继承来源对话的项目，编辑时省略保留原项目。' },
          model_selection: {
            type: 'object', required: ['providerId', 'modelId'], additionalProperties: false,
            properties: { providerId: { type: 'string' }, modelId: { type: 'string' } },
          },
          thinking_effort: { type: 'string', description: '模型支持的推理强度；留空使用普通模式。' },
        },
      },
    }];
  }

  async systemPrompt(threadId: string): Promise<string> {
    const snapshot = await this.service.snapshot();
    return [
      'Use manage_automation only when the user requests a scheduled task or its management. Saving a schedule does not execute its task immediately.',
      'Gather missing prompt and timing through a short request_user_input form. Infer the task title and use the current conversation model unless the user requests another.',
      'Task dates and clock times use this computer\'s local time automatically. Never ask the user to choose a timezone, and confirm run times in local time without timezone labels.',
      'When the task refers to a project, select its actual project_id from the available projects. Ask only if the project is ambiguous or missing. Never infer an ID or rely on mentioning a project name in the saved prompt to select its workspace.',
      `Current local time: ${this.now().toString()}.`,
      `Available models and efforts: ${JSON.stringify(snapshot.models)}.`,
      `Available projects: ${JSON.stringify(snapshot.projects)}.`,
      `Tasks created in this conversation: ${JSON.stringify(snapshot.tasks.filter((task) => task.conversationThreadId === threadId).map((task) => ({ id: task.id, title: task.title, schedule: task.schedule, status: task.status, projectId: task.projectId })))}`,
    ].join('\n');
  }

  async runTool(value: unknown, threadId: string) {
    const input = record(value);
    if (input.mode === 'list') return { content: JSON.stringify(await this.service.snapshot()), preview: '已读取定时任务' };
    const taskId = input.mode === 'create' ? undefined : identity(input.task_id);
    if (input.mode === 'delete') return { content: JSON.stringify(await this.service.delete(taskId!)), preview: '已删除定时任务' };
    const task = input.mode === 'pause' || input.mode === 'resume'
      ? await this.service.setStatus(taskId!, input.mode === 'pause' ? 'paused' : 'active')
      : input.mode === 'run' ? await this.service.run(taskId!)
      : input.mode === 'create' || input.mode === 'update'
        ? await this.save(input, threadId, taskId)
        : undefined;
    if (!task) throw new Error('Invalid automation mode.');
    return {
      content: JSON.stringify(task), preview: task.title,
      data: { resultKind: 'automation.task', resultMajor: 1, payload: task },
    };
  }

  private save(input: Record<string, unknown>, threadId: string, taskId?: string) {
    const draft = automationDraftCodec.parse({
      title: input.title, prompt: input.prompt, schedule: input.schedule, newChat: input.new_chat,
      projectId: input.project_id,
      modelSelection: input.model_selection, thinkingEffort: input.thinking_effort,
    });
    return taskId ? this.service.update(taskId, draft) : this.service.create(threadId, draft);
  }
}
