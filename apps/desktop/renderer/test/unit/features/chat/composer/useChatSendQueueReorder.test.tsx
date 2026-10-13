// @vitest-environment happy-dom

import type { RuntimeQueuedTurnInput } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatSendQueueReorder } from '../../../../../src/features/chat/composer/useChatSendQueueReorder.js';

afterEach(cleanup);

const inputs: RuntimeQueuedTurnInput[] = ['a', 'b', 'c'].map((id) => ({
  id, input: id, createdAt: '2026-10-13T00:00:00.000Z',
}));

function Queue({
  items = inputs,
  disabled = false,
  onReorder,
}: {
  items?: RuntimeQueuedTurnInput[];
  disabled?: boolean;
  onReorder: (ids: string[]) => Promise<boolean>;
}) {
  const reorder = useChatSendQueueReorder({ items, disabled, onReorder });
  return <ol ref={reorder.listRef} {...reorder.listProps}>
    {items.map((item) => <li key={item.id} data-queue-id={item.id}>
      <button {...reorder.handleProps(item.id)}>{item.id}</button>
    </li>)}
  </ol>;
}

function startDrag(id: string) {
  const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn() };
  fireEvent.dragStart(screen.getByRole('button', { name: id }), { dataTransfer });
  return dataTransfer;
}

it('commits the drop once, including after leaving and re-entering the queue', async () => {
  let finish!: (accepted: boolean) => void;
  const onReorder = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  render(<Queue onReorder={onReorder} />);
  const list = screen.getByRole('list');
  const dataTransfer = startDrag('a');
  fireEvent.dragOver(list, { dataTransfer, clientY: 100 });
  fireEvent.dragLeave(list, { dataTransfer, relatedTarget: document.body });
  fireEvent.dragOver(list, { dataTransfer, clientY: 100 });
  expect(onReorder).not.toHaveBeenCalled();
  fireEvent.drop(list, { dataTransfer });
  fireEvent.dragEnd(screen.getByRole('button', { name: 'a' }), { dataTransfer });
  fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'ArrowUp' });
  expect(onReorder).toHaveBeenCalledExactlyOnceWith(['b', 'c', 'a']);
  await act(async () => { finish(true); });
});

it('cancels stale drags when dispatch changes the queue and ignores external drops', () => {
  const onReorder = vi.fn(async () => true);
  const { rerender } = render(<Queue onReorder={onReorder} />);
  const dataTransfer = startDrag('c');
  fireEvent.dragOver(screen.getByRole('list'), { dataTransfer, clientY: -1 });
  rerender(<Queue items={inputs.slice(1)} onReorder={onReorder} />);
  fireEvent.drop(screen.getByRole('list'), { dataTransfer });
  fireEvent.drop(screen.getByRole('list'), { dataTransfer: new DataTransfer() });
  expect(onReorder).not.toHaveBeenCalled();
});

it('cancels a disabled or abandoned drag and supports keyboard reordering without boundary requests', async () => {
  const onReorder = vi.fn(async () => true);
  const { rerender } = render(<Queue onReorder={onReorder} />);
  const dataTransfer = startDrag('a');
  fireEvent.dragOver(screen.getByRole('list'), { dataTransfer, clientY: 100 });
  rerender(<Queue disabled onReorder={onReorder} />);
  fireEvent.drop(screen.getByRole('list'), { dataTransfer });
  rerender(<Queue onReorder={onReorder} />);
  startDrag('a');
  fireEvent.dragEnd(screen.getByRole('button', { name: 'a' }));
  fireEvent.drop(screen.getByRole('list'), { dataTransfer });
  fireEvent.keyDown(screen.getByRole('button', { name: 'a' }), { key: 'ArrowUp' });
  fireEvent.keyDown(screen.getByRole('button', { name: 'c' }), { key: 'ArrowDown' });
  expect(onReorder).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('button', { name: 'c' }), { key: 'ArrowUp' });
  });
  expect(onReorder).toHaveBeenCalledExactlyOnceWith(['a', 'c', 'b']);
});
