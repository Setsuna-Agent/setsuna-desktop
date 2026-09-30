import { afterEach, expect, it, vi } from 'vitest';
import type { AutomationTask } from '../../src/contracts/index.js';
import { automationForm, draftFromForm } from '../../src/renderer/form.js';
import { nextAutomationRun } from '../../src/runtime/schedule.js';

afterEach(() => vi.restoreAllMocks());

it('saves an edited calendar task against the local clock instead of a hidden old setting', () => {
  const options = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...options, timeZone: 'Asia/Shanghai' });
  const task: AutomationTask = {
    id: 'task', title: 'Morning task', prompt: 'Prepare the daily report', newChat: false,
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    conversationThreadId: 'setup', status: 'active', nextRunAt: '2026-09-30T09:00:00.000Z',
    createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', runs: [],
  };
  const draft = draftFromForm(automationForm(task));
  expect(draft.schedule).toEqual({ kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' });
  expect(nextAutomationRun(draft.schedule, new Date('2026-09-30T00:59:00Z'))).toBe('2026-09-30T01:00:00.000Z');
});
