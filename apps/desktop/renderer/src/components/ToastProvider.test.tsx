import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastProvider, enqueueToast, useToast, type ToastEntry } from './ToastProvider.js';

describe('ToastProvider', () => {
  it('provides one shared toast API to descendants', () => {
    function ToastConsumer() {
      const toast = useToast();
      return <span>{['show', 'success', 'warning', 'error', 'info', 'dismiss'].every((key) => typeof toast[key as keyof typeof toast] === 'function') ? 'ready' : 'missing'}</span>;
    }

    expect(renderToStaticMarkup(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>,
    )).toContain('ready');
  });

  it('deduplicates repeated feedback and keeps the newest four notifications', () => {
    const entries = [1, 2, 3, 4, 5].reduce<ToastEntry[]>((current, id) => enqueueToast(current, {
      durationMs: 3_500,
      id,
      message: `message-${id}`,
      tone: 'success',
    }), []);

    expect(entries.map((toast) => toast.id)).toEqual([2, 3, 4, 5]);
    expect(enqueueToast(entries, {
      durationMs: 3_500,
      id: 6,
      message: 'message-5',
      tone: 'success',
    }).map((toast) => toast.id)).toEqual([2, 3, 4, 6]);
  });
});
