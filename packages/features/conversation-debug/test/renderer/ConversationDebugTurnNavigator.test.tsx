import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationDebugTurnNavigator } from '../../src/renderer/ConversationDebugTurnNavigator.js';
import type { ConversationDebugTurnGroup } from '../../src/renderer/conversationDebugGraph.js';
import { ConversationDebugI18nProvider } from '../../src/renderer/context.js';

describe('ConversationDebugTurnNavigator', () => {
  it('renders every turn as a jump control and marks the active turn', () => {
    const turns: ConversationDebugTurnGroup[] = [
      { id: 'turn_1', inputPreview: 'Inspect', nodeIds: [], runtimeTurnIds: ['turn_1'], seqEnd: 2, seqStart: 1, status: 'success' },
      { id: 'turn_2', inputPreview: 'Edit', nodeIds: [], runtimeTurnIds: ['turn_2'], seqEnd: 4, seqStart: 3, status: 'running' },
    ];
    const html = renderToStaticMarkup(
      <ConversationDebugI18nProvider
        locale="zh-CN"
        translate={(key, params) => {
          if (key.endsWith('jumpToTurn')) return `跳到第 ${params?.index} 轮（${params?.status}）`;
          if (key.endsWith('status.running')) return '进行中';
          if (key.endsWith('status.success')) return '完成';
          if (key.endsWith('turnLabel')) return `轮次 ${params?.index}`;
          return key;
        }}
      >
        <ConversationDebugTurnNavigator activeTurnId="turn_2" turns={turns} onNavigate={() => undefined} />
      </ConversationDebugI18nProvider>,
    );

    expect(html.match(/conversation-debug-flow__navigator-turn/gu)).toHaveLength(2);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('跳到第 2 轮（进行中）');
  });
});
