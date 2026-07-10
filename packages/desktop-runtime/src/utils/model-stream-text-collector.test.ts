import { describe, expect, it } from 'vitest';
import type { ModelStreamEvent } from '@setsuna-desktop/contracts';
import { createModelStreamTextCollector } from './model-stream-text-collector.js';

describe('model stream text collector', () => {
  it('collects legacy and item-based agent output without duplicating completed content', () => {
    const collector = createModelStreamTextCollector();
    const events: ModelStreamEvent[] = [
      { type: 'text_delta', text: 'legacy ' },
      { type: 'item_started', item: { id: 'agent_1', kind: 'agent_message', status: 'in_progress' } },
      { type: 'item_delta', itemId: 'agent_1', delta: 'item ' },
      { type: 'item_delta', itemId: 'agent_1', delta: 'output' },
      { type: 'item_completed', item: { id: 'agent_1', kind: 'agent_message', content: 'item output', status: 'completed' } },
    ];

    events.forEach((event) => collector.consume(event));

    expect(collector.text()).toBe('legacy item output');
  });

  it('uses completed agent content and ignores reasoning items', () => {
    const collector = createModelStreamTextCollector();
    collector.consume({ type: 'item_started', item: { id: 'reasoning_1', kind: 'reasoning', status: 'in_progress' } });
    collector.consume({ type: 'item_delta', itemId: 'reasoning_1', delta: 'private reasoning' });
    collector.consume({ type: 'item_completed', item: { id: 'agent_1', kind: 'agent_message', content: 'visible answer', status: 'completed' } });

    expect(collector.text()).toBe('visible answer');
  });

  it('keeps deltas from compatible providers that omit item lifecycle events', () => {
    const collector = createModelStreamTextCollector();
    collector.consume({ type: 'item_delta', itemId: 'agent_without_start', delta: 'fallback output' });

    expect(collector.text()).toBe('fallback output');
  });
});
