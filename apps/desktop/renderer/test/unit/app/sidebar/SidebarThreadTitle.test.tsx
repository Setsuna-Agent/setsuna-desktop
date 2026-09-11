// @vitest-environment happy-dom

import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidebarThreadRow } from '../../../../src/app/sidebar/SidebarThreadRow.js';

vi.mock('../../../../src/app/sidebar/SidebarFloatingMenu.js', () => ({ SidebarFloatingMenu: () => null }));

let viewportWidth: number;
let preference: MediaQueryList;
let resized: () => void;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  viewportWidth = 140;
  preference = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn(() => preference));
  disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  // happy-dom has no layout engine; model the available width and natural text width.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return (this.textContent?.length ?? 0) * 8;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('scrolls only an overflowing hovered row, preserves its accessible name and selection, and resets on leave', () => {
  const onSelect = vi.fn();
  const view = renderRow(longTitle, onSelect);
  const button = screen.getByRole('button', { name: longTitle });
  const row = button.closest('.desktop-agent-session')!;
  expect(view.container.querySelector('.is-scrolling')).toBeNull();

  fireEvent.mouseEnter(row);
  const track = view.container.querySelector<HTMLElement>('.is-scrolling')!;
  expect(track.style.getPropertyValue('--sidebar-title-loop-gap')).toBe('100px');
  expect(track.querySelector('[aria-hidden="true"]')?.textContent).toBe(longTitle);
  fireEvent.click(screen.getByRole('button', { name: longTitle }));
  expect(onSelect).toHaveBeenCalledWith('thread-1');

  act(() => { viewportWidth = 800; resized(); });
  expect(view.container.querySelector('.is-scrolling')).toBeNull();
  act(() => { viewportWidth = 140; resized(); });
  expect(view.container.querySelector('.is-scrolling')).not.toBeNull();

  fireEvent.mouseLeave(row);
  expect(view.container.querySelector('.is-scrolling')).toBeNull();
  expect(button.textContent).toBe(longTitle);
  expect(disconnect).toHaveBeenCalledOnce();
});

it('keeps short titles and reduced-motion titles static, including preference changes during hover', () => {
  const view = renderRow('Short title');
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Short title' }).closest('.desktop-agent-session')!);
  expect(view.container.querySelector('.is-scrolling')).toBeNull();

  Object.assign(preference, { matches: true });
  view.rerender(rowElement(longTitle));
  expect(view.container.querySelector('.is-scrolling')).toBeNull();
  act(() => {
    Object.assign(preference, { matches: false });
    preference.dispatchEvent(new Event('change'));
  });
  expect(view.container.querySelector('.is-scrolling')).not.toBeNull();
  act(() => {
    Object.assign(preference, { matches: true });
    preference.dispatchEvent(new Event('change'));
  });
  expect(view.container.querySelector('.is-scrolling')).toBeNull();
  expect(screen.getByRole('button', { name: longTitle })).toBeTruthy();
});

const longTitle = 'A long conversation title that cannot fit within the sidebar';

function rowElement(title: string, onSelect = vi.fn()) {
  const thread: RuntimeThreadSummary = {
    id: 'thread-1', title, createdAt: '', updatedAt: '', archived: false, messageCount: 0, lastMessagePreview: '',
  };
  return <SidebarThreadRow
    menuOpen={false} selected={false} thread={thread} variant="project"
    onArchive={vi.fn()} onRename={vi.fn()} onSelect={onSelect} onToggleMenu={vi.fn()}
  />;
}

function renderRow(title: string, onSelect = vi.fn()) {
  return render(rowElement(title, onSelect));
}
