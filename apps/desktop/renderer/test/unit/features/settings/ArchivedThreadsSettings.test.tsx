// @vitest-environment happy-dom
import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArchivedThreadsSettings } from '../../../../src/features/settings/sections/ArchivedThreadsSettings.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('restores owned design chats and deletes only the archive rows shown when confirmation opened', async () => {
  const primary: RuntimeThreadSummary = { id: 'ordinary', title: 'Ordinary', archived: true, messageCount: 1,
    lastMessagePreview: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  const design = { ...primary, id: 'board', title: 'Board', featureId: 'design', origin: { featureId: 'design', entityId: 'draft' } };
  const restoredDesign = { ...design, id: 'other-board', title: 'Other board' };
  const detachedDesign = { ...design, id: 'detached', title: 'Deleted draft', origin: { featureId: 'design', entityId: null } };
  const laterArchive = { ...design, id: 'active', title: 'Later archive', archived: false };
  const threads = [primary, design, restoredDesign, detachedDesign, laterArchive,
    { ...design, id: 'agent', parentThreadId: design.id }, { ...design, id: 'assistant', featureId: 'assistants' }];
  vi.stubGlobal('setsunaDesktop', { runtime: { request: async () => ({ threads }) } });
  const onDeleteAll = vi.fn(async () => {});
  const onRestore = vi.fn(async (id: string) => {
    const restored = threads.find((thread) => thread.id === id)!;
    restored.archived = false;
    return { ...restored, messages: [], lastSeq: 0 };
  });
  render(<ArchivedThreadsSettings threads={[primary]} onDeleteAll={onDeleteAll} onRestore={onRestore} onDelete={vi.fn()} />);
  const detachedRow = await screen.findByRole('group', { name: detachedDesign.title });
  expect(within(detachedRow).queryByRole('button', { name: '恢复' })).toBeNull();
  const row = await screen.findByRole('group', { name: restoredDesign.title });
  fireEvent.click(within(row).getByRole('button', { name: '恢复' }));
  await waitFor(() => expect(screen.queryByRole('group', { name: restoredDesign.title })).toBeNull());
  expect(restoredDesign.archived).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '全部删除' }));
  const dialog = await screen.findByRole('dialog');
  laterArchive.archived = true;
  fireEvent(window, new Event('focus'));
  await screen.findByText(laterArchive.title);
  fireEvent.click(within(dialog).getByRole('button', { name: '全部删除' }));
  await waitFor(() => expect(onDeleteAll).toHaveBeenCalledExactlyOnceWith([primary.id, design.id, detachedDesign.id]));
});
