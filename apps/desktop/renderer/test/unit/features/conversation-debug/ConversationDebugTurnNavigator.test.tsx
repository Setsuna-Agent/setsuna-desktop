import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationDebugTurnNavigator } from '../../../../src/features/conversation-debug/ConversationDebugTurnNavigator.js';
import type { ConversationDebugTurnGroup } from '../../../../src/features/conversation-debug/conversationDebugGraph.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

describe('ConversationDebugTurnNavigator', () => {
  it('renders compact numbered turns and marks the turn in the current viewport', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="zh-CN">
        <ConversationDebugTurnNavigator
          activeTurnId="turn_2"
          turns={[
            debugTurn('turn_1', '读取项目结构', 'success'),
            debugTurn('turn_2', '修改画布交互', 'running'),
          ]}
          onNavigate={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="轮次导航"');
    expect(html).toContain('读取项目结构');
    expect(html).toContain('修改画布交互');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('跳到第 2 轮（进行中）');
    expect(html).toContain('<span>1</span>');
    expect(html).toContain('<span>2</span>');
    expect(html).not.toContain('conversation-debug-flow__navigator-label');
    expect(html).not.toContain('>轮次 1<');
  });
});

function debugTurn(
  id: string,
  inputPreview: string,
  status: ConversationDebugTurnGroup['status'],
): ConversationDebugTurnGroup {
  return {
    id,
    inputPreview,
    nodeIds: [],
    runtimeTurnIds: [id],
    seqEnd: 2,
    seqStart: 1,
    status,
  };
}
