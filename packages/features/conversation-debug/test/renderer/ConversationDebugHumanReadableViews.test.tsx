// @vitest-environment happy-dom

import type { RuntimeEvent, RuntimeThread } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationDebugActivityList } from '../../src/renderer/ConversationDebugActivityList.js';
import { ConversationDebugInspector } from '../../src/renderer/ConversationDebugInspector.js';
import { ConversationDebugPanel } from '../../src/renderer/ConversationDebugPanel.js';
import type { ConversationDebugNode } from '../../src/renderer/conversationDebugGraph.js';
import { ConversationDebugI18nProvider } from '../../src/renderer/context.js';
import {
  ConversationDebugUiProvider,
} from '../../src/renderer/host-ui.js';
import { createNoopConversationDebugRendererService } from '../../src/renderer/service.js';

afterEach(cleanup);

describe('human-readable conversation debug views', () => {
  it('renders semantic activities without exposing raw event names or IDs', () => {
    const html = renderWithProviders(
      <ConversationDebugActivityList
        nodes={[messageNode()]}
        selectedNodeId={null}
        onSelectNode={() => undefined}
      />,
    );

    expect(html).toContain('助手回复');
    expect(html).toContain('正在检查项目结构');
    expect(html).toContain('模型 · 进行中');
    expect(html).toContain('2 条记录');
    expect(html).not.toContain('message.delta');
    expect(html).not.toContain('event_message_delta');
    expect(html).not.toContain('E#');
  });

  it('keeps raw records out of the default diagnostics view', () => {
    const html = renderWithProviders(
      <ConversationDebugInspector
        contextEvents={[]}
        node={messageNode()}
        selectedRecordId="event_message_delta"
        onClose={() => undefined}
        onSelectRecord={() => undefined}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('诊断概览');
    expect(html).toContain('原始记录');
    expect(html).not.toContain('event_message_delta');
    expect(html).not.toContain('<details');
  });

  it('navigates node records and returns to the requested view or turn scope', async () => {
    const { events, thread } = panelFixture();
    const service = {
      ...createNoopConversationDebugRendererService(),
      listEvents: async () => ({ records: events, throughSeq: thread.lastSeq }),
    };
    render(withProviders(
      <ConversationDebugPanel
        eventSource={{ subscribeEvents: () => () => undefined }}
        thread={thread}
        resizeMax={900}
        resizeMin={300}
        resizeValue={500}
        service={service}
        onResizeStart={() => undefined}
        onResizeStep={() => undefined}
      />,
    ));

    fireEvent.click(await screen.findByRole('button', { name: /正在检查项目结构/ }));
    fireEvent.click(screen.getByRole('tab', { name: /原始记录/ }));
    expect(screen.getByLabelText('安全化事件数据').textContent).toContain('event_message_delta');
    fireEvent.click(screen.getByRole('button', { name: '上一条记录' }));
    expect(screen.getByLabelText('安全化事件数据').textContent).toContain('event_message_created');

    fireEvent.click(screen.getByRole('button', { name: '活动记录' }));
    expect(screen.queryByRole('button', { name: '关闭节点详情' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /正在检查项目结构/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '全部轮次' }), {
      target: { value: 'latest' },
    });
    expect(screen.queryByRole('button', { name: '关闭节点详情' })).toBeNull();
    expect(screen.queryByRole('button', { name: /正在检查项目结构/ })).toBeNull();
    expect(screen.getByRole('button', { name: /已完成检查/ })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: '全部轮次' }), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('button', { name: '关系图' }));
    fireEvent.click(screen.getByRole('button', { name: /正在检查项目结构/ }));
    fireEvent.click(screen.getByRole('button', { name: '关闭节点详情' }));
    expect(screen.queryByRole('button', { name: '关闭节点详情' })).toBeNull();
    expect(screen.getByRole('button', { name: /正在检查项目结构/ })).toBeTruthy();
  });
});

const translate: RendererTranslate = (key, params) => {
  const messages: Partial<Record<string, string>> = {
    'feature.conversationDebug.inspector.close': '关闭节点详情',
    'feature.conversationDebug.inspector.nextRecord': '下一条记录',
    'feature.conversationDebug.inspector.payload': '安全化事件数据',
    'feature.conversationDebug.inspector.previousRecord': '上一条记录',
    'feature.conversationDebug.inspector.selectRecord': '选择原始记录',
    'feature.conversationDebug.inspector.records': '关联记录',
    'feature.conversationDebug.inspector.view.overview': '诊断概览',
    'feature.conversationDebug.inspector.view.records': '原始记录',
    'feature.conversationDebug.inspector.views': '节点详情视图',
    'feature.conversationDebug.inspector.redactionNotice': '敏感字段会被隐藏。',
    'feature.conversationDebug.inspector.sequence': '序号',
    'feature.conversationDebug.inspector.time': '时间',
    'feature.conversationDebug.inspector.turn': '轮次',
    'feature.conversationDebug.lane.provider': '模型',
    'feature.conversationDebug.messageRole.assistant': '助手回复',
    'feature.conversationDebug.mode.events': '活动记录',
    'feature.conversationDebug.mode.flow': '关系图',
    'feature.conversationDebug.node.message': '消息',
    'feature.conversationDebug.status.running': '进行中',
    'feature.conversationDebug.turn.all': '全部轮次',
    'feature.conversationDebug.turn.latest': '最新轮次',
  };
  if (key === 'feature.conversationDebug.recordCountShort') {
    return `${params?.count} 条记录`;
  }
  if (key === 'feature.conversationDebug.recordsInNode') {
    return `${params?.count} 条关联记录`;
  }
  if (key === 'feature.conversationDebug.inspector.recordPosition') {
    return `${params?.index}/${params?.count}`;
  }
  if (key === 'feature.conversationDebug.records.groupPosition') {
    return `连续明细 ${params?.index}/${params?.count}`;
  }
  return messages[key] ?? key;
};

const ui: ComponentProps<typeof ConversationDebugUiProvider>['ui'] = {
  CodeView: ({ 'aria-label': ariaLabel, className, code }) => (
    <pre aria-label={ariaLabel} className={className}><code>{code}</code></pre>
  ),
  EmptyState: ({ title }) => <div>{title}</div>,
  IconButton: ({ children, label, ...props }) => (
    <button {...props} aria-label={label}>{children}</button>
  ),
  ResizeHandle: () => null,
  SelectField: ({ children, onValueChange, ...props }) => (
    <select
      {...props}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
};

function renderWithProviders(children: ReactNode): string {
  return renderToStaticMarkup(withProviders(children));
}

function withProviders(children: ReactNode): ReactNode {
  return (
    <ConversationDebugI18nProvider locale="zh-CN" translate={translate}>
      <ConversationDebugUiProvider ui={ui}>
        {children}
      </ConversationDebugUiProvider>
    </ConversationDebugI18nProvider>
  );
}

function panelFixture(): { events: RuntimeEvent[]; thread: RuntimeThread } {
  const firstEvents = messageNode().events;
  const secondEvents = firstEvents.map((event): RuntimeEvent => {
    const identity = { id: `second_${event.id}`, seq: event.seq + 2, turnId: 'turn_2' };
    if (event.type === 'message.created') {
      return {
        ...event,
        ...identity,
        payload: { message: { ...event.payload.message, id: 'assistant_2', turnId: 'turn_2' } },
      };
    }
    if (event.type === 'message.delta') {
      return {
        ...event,
        ...identity,
        payload: { messageId: 'assistant_2', text: '已完成检查' },
      };
    }
    return { ...event, ...identity };
  });
  const createdAt = firstEvents[0]!.createdAt;
  const thread: RuntimeThread = {
    archived: false,
    createdAt,
    id: 'thread_1',
    lastMessagePreview: '已完成检查',
    lastSeq: 4,
    messageCount: 4,
    messages: [
      { id: 'user_1', role: 'user', content: '检查项目', createdAt, turnId: 'turn_1' },
      { id: 'assistant_1', role: 'assistant', content: '正在检查项目结构', createdAt, turnId: 'turn_1' },
      { id: 'user_2', role: 'user', content: '继续检查', createdAt, turnId: 'turn_2' },
      { id: 'assistant_2', role: 'assistant', content: '已完成检查', createdAt, turnId: 'turn_2' },
    ],
    title: 'Debug navigation',
    updatedAt: createdAt,
  };
  return { events: [...firstEvents, ...secondEvents], thread };
}

function messageNode(): ConversationDebugNode {
  const events: RuntimeEvent[] = [
    {
      createdAt: '2026-08-25T08:00:00.000Z',
      id: 'event_message_created',
      payload: {
        message: {
          content: '',
          createdAt: '2026-08-25T08:00:00.000Z',
          id: 'assistant_1',
          role: 'assistant',
          status: 'streaming',
          turnId: 'turn_1',
        },
      },
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
    },
    {
      createdAt: '2026-08-25T08:00:01.000Z',
      id: 'event_message_delta',
      payload: { messageId: 'assistant_1', text: '正在检查项目结构' },
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
    },
  ];
  return {
    eventIds: events.map((event) => event.id),
    events,
    eventTypes: events.map((event) => event.type),
    id: 'message:assistant_1',
    kind: 'message',
    lane: 'provider',
    seqEnd: 2,
    seqStart: 1,
    source: 'event',
    startedAt: events[0]!.createdAt,
    status: 'running',
    summary: '正在检查项目结构',
    traceIds: [],
    traces: [],
    turnId: 'turn_1',
  };
}
