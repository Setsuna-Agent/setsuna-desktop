import type { RuntimeQueuedTurnInput } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatSendQueue } from '../../../../../src/features/chat/composer/ChatSendQueue.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

describe('ChatSendQueue', () => {
  it('renders queued inputs in order with their available actions', () => {
    const html = renderQueue([
      queuedInput({ id: 'queued_1', input: '先检查测试' }),
      queuedInput({
        id: 'queued_2',
        input: '',
        attachments: [{
          id: 'attachment_1',
          name: '需求说明.pdf',
          type: 'application/pdf',
          size: 1024,
          source: 'runtime',
          assetId: 'asset_1',
        }],
      }),
    ]);

    expect(html).toContain('待发送');
    expect(html).toContain('先检查测试');
    expect(html).toContain('需求说明.pdf');
    expect(html).toContain('附件消息');
    expect(html).toContain('立即发送');
    expect(html).toContain('aria-label="编辑"');
    expect(html.match(/aria-label="编辑"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="删除"');
    expect(html).not.toContain('chat-send-queue__header');
    expect(html).not.toContain('<textarea');
    expect(html.indexOf('先检查测试')).toBeLessThan(html.indexOf('需求说明.pdf'));
  });

  it('does not reserve composer space when the queue is empty', () => {
    expect(renderQueue([])).toBe('');
  });

  it('blocks edit without disabling send-now when the composer already has content', () => {
    const html = renderQueue([
      queuedInput({ id: 'queued_1', input: 'Keep current draft safe' }),
    ], true);

    expect(html).toContain('aria-label="请先发送或清空当前输入内容，再编辑队列消息"');
    expect(html).toContain('aria-label="立即发送"');
  });

  it('keeps Goal send-now disabled until the active turn finishes', () => {
    const html = renderQueue([
      queuedInput({ id: 'queued_message', input: 'Message', kind: 'message' }),
      queuedInput({ id: 'queued_goal', input: 'Goal', kind: 'goal' }),
    ], false, true);

    expect(html).toContain('data-queue-kind="message"');
    expect(html).toContain('data-queue-kind="goal"');
    expect(html).toMatch(/class="chat-send-queue__marker is-goal" role="img" aria-label="[^"]+"/);
    expect(html.match(/aria-label="目标需等待当前轮次结束"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="立即发送"');
  });
});

function renderQueue(
  items: RuntimeQueuedTurnInput[],
  editDisabled = false,
  hasActiveTurn = false,
): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="zh-CN">
      <ChatSendQueue
        editDisabled={editDisabled}
        hasActiveTurn={hasActiveTurn}
        items={items}
        onDelete={vi.fn(async () => true)}
        onEdit={vi.fn(async () => true)}
        onSendNow={vi.fn(async () => true)}
      />
    </I18nProvider>,
  );
}

function queuedInput(
  overrides: Partial<RuntimeQueuedTurnInput>,
): RuntimeQueuedTurnInput {
  return {
    id: 'queued_input',
    input: 'Queued input',
    createdAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}
