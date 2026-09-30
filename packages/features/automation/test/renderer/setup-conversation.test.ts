import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { automationSetupPending } from '../../src/renderer/setup-conversation.js';

const setup: RuntimeThread = {
  id: 'setup', title: 'New task', archived: false, lastSeq: 2, messageCount: 2, lastMessagePreview: '',
  createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
  messages: [
    { id: 'policy', role: 'developer', visibility: 'model', status: 'complete', content: 'Setup policy', createdAt: '2026-09-30T00:00:00.000Z' },
    { id: 'welcome', role: 'assistant', status: 'complete', content: 'Welcome', createdAt: '2026-09-30T00:00:00.000Z' },
  ],
};

describe('automation setup conversation', () => {
  it('recognizes the seeded conversation before the first user turn', () => {
    expect(automationSetupPending(setup)).toBe(true);
    expect(automationSetupPending({ ...setup, messages: setup.messages.slice(0, 1) })).toBe(true);
    expect(automationSetupPending(null)).toBe(false);
  });

  it('leaves setup as soon as a user prompt is persisted, before the active-turn update arrives', () => {
    const prompt = { ...setup.messages[0], id: 'prompt', role: 'user' as const, visibility: 'transcript' as const, content: 'Every day at nine' };
    expect(automationSetupPending({ ...setup, messages: [...setup.messages, prompt] })).toBe(false);
    expect(automationSetupPending({ ...setup, messages: [{ ...setup.messages[1], turnId: 'turn-1' }] })).toBe(false);
  });

  it('does not treat active, queued or partially loaded conversation history as a new task', () => {
    expect(automationSetupPending({ ...setup, activeTurnId: 'turn-1' })).toBe(false);
    expect(automationSetupPending({ ...setup, queuedTurnInputs: [{ id: 'queued', input: 'Every hour', createdAt: setup.createdAt }] })).toBe(false);
    expect(automationSetupPending({ ...setup, messagePage: { nextBefore: 1, total: 50 } })).toBe(false);
  });
});
