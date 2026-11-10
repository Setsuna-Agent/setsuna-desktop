import { runtimeText, type RuntimeInterfaceLanguage, type RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { automationScheduleInputSchema } from '@setsuna-desktop/feature-automation/contracts';
import { assistantReminderDraftCodec, identity, type Assistant, type AssistantReminder, type AssistantToolContext } from '../contracts/index.js';
import type { AssistantTurnRoute } from './deliveries.js';
import type { AssistantReminders } from './reminders.js';

export const REMINDER_TOOL_NAME = 'assistant_manage_reminder';

export function reminderToolDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const t = runtimeText(language);
  return {
    name: REMINDER_TOOL_NAME,
    description: t(
      'Create, list, update, pause, resume or delete this assistant\'s scheduled messages. Call list first for the current local time. QQ requests automatically deliver to their originating private chat or group; do not ask the user to choose a recipient.',
      '创建、查询、修改、暂停、恢复或取消此助理的定时消息。先 list 取得本机时间。QQ 中创建的提醒自动发回原私聊或群聊，无需选择收件人；桌面创建的提醒显示在助理聊天中。',
    ),
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['mode'], properties: {
        mode: { type: 'string', enum: ['list', 'create', 'update', 'pause', 'resume', 'delete'] },
        reminder_id: { type: 'string', description: '操作已有提醒时使用 list 返回的真实 ID。' },
        title: { type: 'string', maxLength: 120 },
        instructions: { type: 'string', description: '到点时生成或执行哪一条消息；只保存单次执行内容，不要重复要求创建定时任务。' },
        schedule: automationScheduleInputSchema,
      },
    },
  };
}

function view(reminder: AssistantReminder, reminders: AssistantReminders) {
  return {
    reminder_id: reminder.id, title: reminder.title, instructions: reminder.instructions, schedule: reminder.schedule,
    status: reminder.status, next_run_at: reminder.nextRunAt,
    delivery: reminder.peer ? (reminder.peer.kind === 'c2c' ? 'qq-private' : 'qq-group') : 'assistant-chat',
    last_delivery: reminders.latestDelivery(reminder.id),
    ...(reminder.lastRun?.turnId ? { last_run: { thread_id: reminder.lastRun.threadId, turn_id: reminder.lastRun.turnId, scheduled_for: reminder.lastRun.scheduledFor } } : {}),
  };
}

export async function runReminderTool(reminders: AssistantReminders, assistant: Assistant, input: Record<string, unknown>, context: AssistantToolContext, now: Date, route?: AssistantTurnRoute) {
  if (input.mode === 'list') return { data: {
    now: now.toISOString(), local_time: now.toLocaleString('sv-SE'), time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reminders: reminders.visible(assistant.id, route).map((item) => view(item, reminders)), execution: 'on-this-computer',
  }, preview: '定时提醒' };
  if (input.mode === 'create') {
    if (reminders.isScheduledTurn(context.threadId, context.turnId)) throw new Error('本次已是定时触发，请只执行提醒内容，不要再次创建提醒。');
    const reminder = await reminders.create(assistant, assistantReminderDraftCodec.parse(input), route);
    return { data: { reminder: view(reminder, reminders) }, preview: reminder.title };
  }
  if (input.mode !== 'update' && input.mode !== 'pause' && input.mode !== 'resume' && input.mode !== 'delete') throw new Error('Invalid reminder mode.');
  const id = identity(input.reminder_id, 'reminder_id');
  const reminder = await reminders.change(assistant.id, id, input.mode, input, route);
  return { data: reminder ? { reminder: view(reminder, reminders) } : { deleted: true, reminder_id: id }, preview: reminder?.title ?? '已取消提醒' };
}
