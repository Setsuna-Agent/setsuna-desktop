// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitChangesSplit } from '../../../src/renderer/history/GitChangesSplit.js';
import { ReviewRendererTestHost } from '../review-renderer-test-host.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(scale = 1) {
  let availableWidth = 900;
  let resized = () => undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => undefined) { resized = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => availableWidth);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 100, y: 0, left: 100, top: 0, right: 100 + availableWidth * scale, bottom: 700,
    width: availableWidth * scale, height: 700, toJSON: () => ({}),
  }));
  const view = render(
    <GitChangesSplit navigation={<nav>Files</nav>} detailOpen={false} editingMessage={false}><div>Diff</div></GitChangesSplit>,
    { wrapper: ReviewRendererTestHost },
  );
  const handle = screen.getByRole('separator', { name: '调整 Git 侧栏宽度' });
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  return {
    ...view, handle, disconnect,
    width: () => Number(handle.getAttribute('aria-valuenow')),
    resize: (value: number) => act(() => { availableWidth = value; resized(); }),
  };
}

describe('Git sidebar resizing', () => {
  it('resizes the right sidebar in CSS pixels under UI zoom, clamps both sides, and ends on cancel or release', () => {
    const { handle, width } = setup(1.25);
    expect(width()).toBe(260);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 900 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 900 });
    expect(width()).toBe(260);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 805 });
    expect(width()).toBe(336);
    expect(handle.parentElement?.style.getPropertyValue('--git-nav-width')).toBe('336px');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -100 });
    expect(width()).toBe(660);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 2000 });
    expect(width()).toBe(220);
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    expect(width()).toBe(220);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 950 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 825 });
    fireEvent.pointerUp(handle, { pointerId: 3 });
    expect(width()).toBe(320);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(3);
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 800 });
    expect(width()).toBe(320);
  });

  it('preserves the chosen width across content changes and temporary workspace constraints, with keyboard resizing', () => {
    const { handle, width, resize, rerender, unmount, disconnect } = setup();
    fireEvent.keyDown(handle, { key: 'End' });
    expect(width()).toBe(660);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(width()).toBe(644);
    rerender(<GitChangesSplit navigation={<nav>Files</nav>} detailOpen editingMessage><textarea defaultValue="Message" /></GitChangesSplit>);
    expect(width()).toBe(644);
    resize(700);
    expect(width()).toBe(460);
    resize(500);
    expect(width()).toBe(340);
    resize(900);
    expect(width()).toBe(644);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(width()).toBe(220);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(width()).toBe(236);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
