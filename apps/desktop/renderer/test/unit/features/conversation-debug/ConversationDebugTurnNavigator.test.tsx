import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationDebugTurnNavigator } from '../../../../src/features/conversation-debug/ConversationDebugTurnNavigator.js';
import type { ConversationDebugTurnGroup } from '../../../../src/features/conversation-debug/conversationDebugGraph.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

describe('ConversationDebugTurnNavigator', () => {
  it('renders every turn as a jump control and marks the active turn', () => {
    const turns: ConversationDebugTurnGroup[] = [
      { id: 'turn_1', inputPreview: 'Inspect', nodeIds: [], runtimeTurnIds: ['turn_1'], seqEnd: 2, seqStart: 1, status: 'success' },
      { id: 'turn_2', inputPreview: 'Edit', nodeIds: [], runtimeTurnIds: ['turn_2'], seqEnd: 4, seqStart: 3, status: 'running' },
    ];
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="zh-CN">
        <ConversationDebugTurnNavigator activeTurnId="turn_2" turns={turns} onNavigate={() => undefined} />
      </I18nProvider>,
    );

    expect(html.match(/conversation-debug-flow__navigator-turn/gu)).toHaveLength(2);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('跳到第 2 轮（进行中）');
  });
});
