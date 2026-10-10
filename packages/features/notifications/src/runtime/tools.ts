import { randomUUID } from 'node:crypto';
import { readNotificationInput, record, type NotificationInput, type NotificationReceipt,
  type NotificationToolContext, type NotificationToolService } from '../contracts/index.js';

type Sender = { send(input: NotificationInput, signal?: AbortSignal): Promise<NotificationReceipt> };
export class NotificationTools implements NotificationToolService {
  constructor(private readonly sender: Sender | null) {}
  listTools() {
    return this.sender ? [{
      name: 'send_notification',
      description: '发送 macOS / Windows 原生系统通知，点击通知返回当前对话。用于用户明确要求的通知或提醒。任务完成且应用在后台时，系统会自动通知最终回答，不要为普通任务完成重复调用本工具。仅立即发送；未来提醒使用 manage_automation 安排任务，在执行时调用本工具。应用关闭时不会执行定时任务。收到系统 show 回调才返回 shown；权限拒绝、原生失败或超时会使工具失败，此时不能声称通知已发送。横幅展示仍遵循系统勿扰设置。',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['title', 'body'],
        properties: { title: { type: 'string', maxLength: 200 }, body: { type: 'string', maxLength: 5000 } },
      },
    }] : [];
  }
  async send(value: unknown, context: NotificationToolContext) {
    if (!this.sender || context.readOnly) throw new Error('Desktop notifications are unavailable in this turn.');
    context.signal?.throwIfAborted();
    const input = record(value);
    const request = readNotificationInput({
      title: input.title, body: input.body,
      // Models cannot redirect a notification to another conversation or choose its deduplication ID.
      threadId: context.threadId, id: `${context.threadId}:${context.toolCallId ?? randomUUID()}`,
    });
    const result = await this.sender.send(request, context.signal);
    return { content: JSON.stringify(result), preview: request.title };
  }
}
