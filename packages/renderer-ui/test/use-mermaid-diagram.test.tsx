// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderMermaidDiagram } from '../src/mermaid-renderer.js';
import { useMermaidDiagram } from '../src/use-mermaid-diagram.js';

vi.mock('../src/mermaid-renderer.js', () => ({ renderMermaidDiagram: vi.fn() }));
const renderDiagram = vi.mocked(renderMermaidDiagram);

beforeEach(() => {
  vi.useFakeTimers();
  renderDiagram.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('coalesces streamed tokens and ignores an old layout result after the source changes', async () => {
  let finishOld!: (src: string) => void;
  renderDiagram.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  const { result, rerender } = renderHook(({ code }) => useMermaidDiagram(code), { initialProps: { code: 'flowchart LR\nA' } });
  rerender({ code: 'flowchart LR\nA -->' });
  rerender({ code: 'flowchart LR\nA --> B' });
  expect(renderDiagram).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(renderDiagram).toHaveBeenCalledTimes(1);
  const oldSignal = renderDiagram.mock.calls[0][2];

  renderDiagram.mockResolvedValueOnce('new-image');
  rerender({ code: 'flowchart LR\nA --> C' });
  expect(oldSignal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current).toBe('new-image');
  await act(async () => { finishOld('old-image'); });
  expect(result.current).toBe('new-image');
});

it('clears a previous result on invalid source and recovers when the source is corrected', async () => {
  renderDiagram.mockResolvedValueOnce('valid-image');
  const { result, rerender } = renderHook(({ code }) => useMermaidDiagram(code), { initialProps: { code: 'flowchart LR\nA --> B' } });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current).toBe('valid-image');

  renderDiagram.mockRejectedValueOnce(new Error('Invalid diagram'));
  rerender({ code: 'flowchart LR\nA[' });
  expect(result.current).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current).toBeNull();

  renderDiagram.mockResolvedValueOnce('corrected-image');
  rerender({ code: 'flowchart LR\nA[开始] --> B[结束]' });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current).toBe('corrected-image');
});

it('cancels both delayed work and an in-flight result when a diagram is unmounted', async () => {
  const delayed = renderHook(() => useMermaidDiagram('flowchart LR\nA --> B'));
  delayed.unmount();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(renderDiagram).not.toHaveBeenCalled();

  let finish!: (src: string) => void;
  renderDiagram.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = renderHook(() => useMermaidDiagram('flowchart LR\nA --> B'));
  await act(() => vi.advanceTimersByTimeAsync(200));
  const signal = renderDiagram.mock.calls[0][2];
  pending.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { finish('late-image'); });
});
