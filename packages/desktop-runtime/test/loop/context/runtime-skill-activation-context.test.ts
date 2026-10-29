import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { currentTurnSkillActivationText } from '../../../src/loop/context/runtime-skill-activation-context.js';

describe('current turn capability activation', () => {
  it('ignores runtime and agent context even when it uses the user role', () => {
    const contexts: Partial<RuntimeMessage>[] = [
      { promptSource: 'collaboration', visibility: 'model' },
      { promptSource: 'collaboration' },
      { visibility: 'model' },
      { promptSource: 'hook' },
      { promptSource: 'runtime_context' },
      { contextCompaction: {} as RuntimeMessage['contextCompaction'] },
      { role: 'assistant' },
      { role: 'tool' },
    ];
    const input = message('Check git status.');
    expect(currentTurnSkillActivationText([
      input,
      ...contexts.map((context) => message('Found report.docx and [$Vercel](plugin://vercel)', context)),
    ], 'turn_current')).toBe(input.content);
  });

  it('keeps assigned tasks, user steering and input attachments, including original inputs retained after compaction', () => {
    const task = message('Create a docx report.', { inputKind: 'subagent_task', promptSource: 'collaboration', visibility: 'transcript' });
    const correction = message('Also inspect the attachment.', {
      attachments: [
        { id: 'input', name: 'reference.pdf', type: 'application/pdf', size: 10, url: 'data:application/pdf;base64,' },
        { id: 'hidden', name: 'hidden.svg', type: 'image/svg+xml', size: 10, url: 'data:,', modelVisible: false },
        { id: 'output', name: 'generated.png', type: 'image/png', size: 10, source: 'generated', assetId: 'asset' },
      ],
    });
    expect(currentTurnSkillActivationText([task, correction], 'turn_current'))
      .toBe('Create a docx report.\nAlso inspect the attachment.\nreference.pdf\napplication/pdf');
  });

  it('supports unscoped legacy input without falling back to another turn or a context message', () => {
    const legacy = message('Inspect code.', { turnId: undefined });
    const hidden = message('Use PDF.', { turnId: undefined, visibility: 'model' });
    const previous = message('Create a docx report.', { turnId: 'turn_previous' });
    expect(currentTurnSkillActivationText([legacy, hidden], 'turn_current')).toBe('Inspect code.');
    expect(currentTurnSkillActivationText([previous, hidden], 'turn_current')).toBe('');
    expect(currentTurnSkillActivationText([legacy, message('Check git status.')], 'turn_current')).toBe('Check git status.');
  });
});

function message(content: string, fields: Partial<RuntimeMessage> = {}): RuntimeMessage {
  return { id: content, turnId: 'turn_current', role: 'user', content, createdAt: '', ...fields };
}
