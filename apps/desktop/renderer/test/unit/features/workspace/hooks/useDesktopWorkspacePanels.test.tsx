// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidePanelTransition } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanels.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSidePanelTransition', () => {
  it('keeps the panel mounted until a reversed closing transition settles', () => {
    vi.useFakeTimers();
    const view = renderHook(
      ({ visible }) => useSidePanelTransition(visible),
      { initialProps: { visible: false } },
    );

    view.rerender({ visible: true });
    expect(view.result.current).toEqual({ phase: 'opening', present: true });

    act(() => vi.advanceTimersByTime(140));
    view.rerender({ visible: false });
    expect(view.result.current).toEqual({ phase: 'closing', present: true });

    act(() => vi.advanceTimersByTime(279));
    expect(view.result.current).toEqual({ phase: 'closing', present: true });

    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current).toEqual({ phase: null, present: false });
  });
});
