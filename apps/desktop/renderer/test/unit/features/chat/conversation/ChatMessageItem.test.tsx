import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageItem } from '../../../../../src/features/chat/conversation/ChatMessageItem.js';
import { RendererPluginTestHost } from '../../../support/RendererPluginTestHost.js';

function renderAssistantMessage(
  segments: RuntimeMessage[],
  active = false,
): string {
  const turnId = segments[0]?.turnId ?? 'turn_assistant';
  return renderToStaticMarkup(
    <RendererPluginTestHost>
      <MessageItem
        activeAssistantItemId={active ? 'assistant_item' : null}
        activeTurnId={active ? turnId : null}
        deleteMode={false}
        item={{
          type: 'assistant',
          id: 'assistant_item',
          handledSteerMessageIds: [],
          messageIds: segments.map((segment) => segment.id),
          segments,
          steerMessages: [],
          turnId,
        }}
        onAnswerApproval={async () => undefined}
        onStartEdit={() => undefined}
        onStartDelete={() => undefined}
        onToggleDelete={() => undefined}
        onWorkHistoryExpandedChange={() => undefined}
        pluginUses={[]}
        selectedForDelete={false}
      />
    </RendererPluginTestHost>,
  );
}

describe('MessageItem assistant tool history', () => {
  it('renders structured reasoning only inside the collapsed thinking disclosure', () => {
    const reasoning = 'after: inspect "before<think>private</think>after", then continue private analysis';
    const html = renderAssistantMessage([{
      id: 'assistant_nested_thinking',
      turnId: 'turn_nested_thinking',
      role: 'assistant',
      content: 'Visible answer.',
      streamParts: [
        { type: 'reasoning', content: reasoning },
        { type: 'content', content: 'Visible answer.' },
        { type: 'reasoning', content: reasoning },
      ],
      createdAt: '2026-08-15T00:00:00.000Z',
      status: 'streaming',
    }], true);
    expect(html).toContain('Visible answer.');
    expect(html).not.toContain(reasoning);
  });

  it('renders completed structured content without falling back to mixed raw text', () => {
    const reasoning = 'private completed reasoning';
    const html = renderAssistantMessage([{
      id: 'assistant_completed_reasoning',
      turnId: 'turn_completed_reasoning',
      role: 'assistant',
      content: `<think>${reasoning}</think>Visible answer.`,
      streamParts: [
        { type: 'reasoning', content: reasoning },
        { type: 'content', content: 'Visible answer.' },
      ],
      phase: 'final_answer',
      createdAt: '2026-08-15T00:00:00.000Z',
      status: 'complete',
    }]);

    expect(html).toContain('Visible answer.');
    expect(html).not.toContain(reasoning);
  });

});
