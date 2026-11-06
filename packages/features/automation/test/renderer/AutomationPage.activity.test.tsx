// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { AutomationSnapshot, AutomationTask } from '../../src/contracts/index.js';
import { AutomationPage } from '../../src/renderer/AutomationPage.js';
import type { AutomationClient } from '../../src/renderer/client.js';
import { automationMessages } from '../../src/renderer/messages.js';

afterEach(cleanup);
const t: RendererTranslate = (key) => automationMessages.messages['en-US'][key] ?? key;

it.each([false, true])('retries deletion of the clicked run without deleting its task or navigating away (archived: %s)', async (archived) => {
  const user = userEvent.setup({ skipHover: true });
  const at = '2026-09-30T00:00:00Z';
  const selected: AutomationTask = {
    id: 'A', title: 'Selected task', prompt: 'Run the task', schedule: { kind: 'interval', minutes: 60 },
    newChat: false, conversationThreadId: 'setup_A', status: 'active', nextRunAt: at,
    createdAt: at, updatedAt: at, runs: [],
  };
  const owner: AutomationTask = { ...selected, id: 'B', title: 'Run owner', conversationThreadId: 'setup_B', runs: [{
    id: 'run_B', threadId: 'execution_B', turnId: 'turn_B', scheduledFor: at, startedAt: at, status: 'completed',
  }] };
  let snapshot: AutomationSnapshot = {
    tasks: archived ? [selected] : [selected, owner], models: [], projects: [],
    archivedRuns: archived ? [{ taskId: owner.id, taskTitle: owner.title, run: owner.runs[0]! }] : [],
  };
  const deleteRun = vi.fn().mockRejectedValueOnce(new Error('Could not delete the run')).mockImplementation(async () => {
    snapshot = { ...snapshot, tasks: archived ? [selected] : [selected, { ...owner, runs: [] }], archivedRuns: [] };
    return { deleted: true };
  });
  const client: AutomationClient = {
    snapshot: vi.fn(async () => snapshot), deleteRun,
    createConversation: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), run: vi.fn(), delete: vi.fn(),
  };
  const openConversation = vi.fn(async () => true);
  render(<ConfirmationProvider><AutomationPage client={client} threadId="setup_A" openConversation={openConversation}
    onSelectStarterPrompt={vi.fn()} ModelPicker={() => null} renderConversation={() => null}
    renderToolbar={() => null} translate={t} locale="en-US" /></ConfirmationProvider>);
  const record = await screen.findByRole('button', { name: /^Run owner.*Completed/u });
  await waitFor(() => expect(record.hasAttribute('disabled')).toBe(false));

  const remove = async () => {
    fireEvent.contextMenu(record, { clientX: 40, clientY: 60 });
    await user.click(await screen.findByRole('menuitem', { name: 'Delete run record' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
  };
  await remove();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not delete the run'));
  await remove();
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Run owner.*Completed/u })).toBeNull());
  expect(deleteRun.mock.calls).toEqual([['B', 'run_B'], ['B', 'run_B']]);
  expect(client.delete).not.toHaveBeenCalled();
  expect(openConversation).toHaveBeenCalledExactlyOnceWith('setup_A');
});
