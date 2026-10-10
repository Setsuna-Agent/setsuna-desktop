import { describe, expect, it, vi } from 'vitest';
import { NotificationTools } from '../../src/runtime/tools.js';

describe('send_notification', () => {
  it('binds reminders to the actual calling conversation, allows unattended delivery and rejects invalid or read-only calls', async () => {
    const send = vi.fn(async () => ({ id: 'thread:call', systemNotification: 'shown' as const }));
    const tools = new NotificationTools({ send });
    const context = { threadId: 'thread', toolCallId: 'call', signal: new AbortController().signal, unattended: true };
    await tools.send({ title: ' Done ', body: 'Ready', threadId: 'forged', id: 'forged' }, context);
    expect(send).toHaveBeenCalledWith({ id: 'thread:call', threadId: 'thread', title: 'Done', body: 'Ready' }, context.signal);
    await expect(tools.send({ title: 'Done', body: 'Ready' }, { ...context, readOnly: true })).rejects.toThrow();
    await expect(tools.send({ title: '', body: 'Ready' }, context)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(new NotificationTools(null).listTools()).toEqual([]);
    send.mockRejectedValueOnce(new Error('Notification permission denied'));
    await expect(tools.send({ title: 'Done', body: 'Ready' }, context)).rejects.toThrow('Notification permission denied');
  });
});
