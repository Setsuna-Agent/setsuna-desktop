// @vitest-environment happy-dom

import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SidebarThreadHoverCard } from '../../../../src/app/sidebar/SidebarThreadHoverCard.js';

afterEach(cleanup);

it.each([0, 400])('dismisses pending and visible previews when selecting a thread after %i ms', async (hoverTime) => {
  const onSelect = vi.fn();
  const thread: RuntimeThreadSummary = {
    id: 'thread-1', title: 'A complete conversation title', projectId: 'project-1',
    updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), createdAt: '',
    archived: false, messageCount: 1, lastMessagePreview: '',
  };
  const content = (disabled = false) => <SidebarThreadHoverCard disabled={disabled} projectName="agent" thread={thread}>
    <Button onClick={onSelect}>{thread.title}</Button>
  </SidebarThreadHoverCard>;
  const view = render(content());
  const button = screen.getByRole('button', { name: thread.title });
  const preview = () => document.querySelector<HTMLElement>('.desktop-agent-thread-preview');

  fireEvent.pointerEnter(button, { pointerType: 'mouse' });
  expect(preview()).toBeNull();
  if (hoverTime) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, hoverTime)); });
    const card = preview()!;
    expect(within(card).getByText(thread.title)).toBeTruthy();
    expect(within(card).getByText('agent')).toBeTruthy();
    expect(card.querySelector('time')?.textContent).toBe('2小时前');
    expect(view.container.contains(card)).toBe(false);
  }

  // Focus may enqueue another delayed open during pointer activation.
  fireEvent.focus(button);
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledOnce();
  expect(preview()).toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(preview()).toBeNull();

  fireEvent.pointerLeave(button, { pointerType: 'mouse' });
  fireEvent.pointerEnter(button, { pointerType: 'mouse' });
  await waitFor(() => expect(preview()).not.toBeNull());
  fireEvent.contextMenu(button);
  view.rerender(content(true));
  expect(preview()).toBeNull();
});
