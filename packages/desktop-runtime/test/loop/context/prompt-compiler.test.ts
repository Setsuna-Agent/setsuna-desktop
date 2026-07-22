import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { compileRuntimePrompt } from '../../../src/loop/context/prompt-compiler.js';

describe('compileRuntimePrompt', () => {
  it('orders fragments by authority and keeps conversation history last', () => {
    const conversation: RuntimeMessage[] = [{
      id: 'current_user',
      role: 'user',
      content: 'Current request',
      createdAt: '2026-07-14T00:00:00.000Z',
    }];
    const result = compileRuntimePrompt({
      createdAt: '2026-07-14T00:00:01.000Z',
      conversationMessages: conversation,
      fragments: [
        { id: 'memory', role: 'user', source: 'memory', trust: 'external', lifecycle: 'turn', content: 'Old memory' },
        { id: 'policy', role: 'developer', source: 'tool_policy', trust: 'runtime', lifecycle: 'runtime', content: 'Tool policy' },
        { id: 'base', role: 'system', source: 'product', trust: 'runtime', lifecycle: 'runtime', content: 'Base policy' },
      ],
    });

    expect(result.messages.map((message) => [message.id, message.role])).toEqual([
      ['base', 'system'],
      ['policy', 'developer'],
      ['memory', 'user'],
      ['current_user', 'user'],
    ]);
    expect(result.manifest).toEqual([
      expect.objectContaining({ id: 'base', role: 'system', source: 'product', trust: 'runtime' }),
      expect.objectContaining({ id: 'policy', role: 'developer', source: 'tool_policy', trust: 'runtime' }),
      expect.objectContaining({ id: 'memory', role: 'user', source: 'memory', trust: 'external' }),
    ]);
    expect(result.manifest[0].contentHash).toMatch(/^sha256:/);
  });

  it('drops empty transient fragments without changing conversation messages', () => {
    const conversation: RuntimeMessage[] = [{ id: 'user', role: 'user', content: 'Hello', createdAt: 'now' }];
    const result = compileRuntimePrompt({
      createdAt: 'now',
      conversationMessages: conversation,
      fragments: [{ id: 'empty', role: 'developer', source: 'hook', trust: 'trusted_local', lifecycle: 'turn', content: '  ' }],
    });

    expect(result.messages).toEqual(conversation);
    expect(result.manifest).toEqual([]);
  });
});
