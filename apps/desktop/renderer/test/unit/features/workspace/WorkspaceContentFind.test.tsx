// @vitest-environment happy-dom
import type { CodeViewHandle } from '@pierre/diffs/react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { WorkspaceContentFind } from '../../../../src/features/workspace/WorkspaceContentFind.js';
import { useCodeViewFind } from '../../../../src/shared/code/useCodeViewFind.js';
import { useContentFindTarget } from '../../../../src/shared/find/useContentFindTarget.js';
import { KeyboardShortcutsProvider } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';

const highlights = new Map<string, Set<Range>>();
const navigate = vi.fn();
beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> {
    priority = 0;
    constructor(...ranges: Range[]) { super(ranges); }
  });
  vi.stubGlobal('CSS', { highlights });
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 10, 50, 20));
});
afterEach(() => {
  cleanup();
  highlights.clear();
  navigate.mockClear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['win32', 'darwin'] as const)('routes %s find to the clicked pane and navigates unmounted lines without affecting chat or another pane', async (platform) => {
  const chatFind = vi.fn();
  const view = render(<KeyboardShortcutsProvider initialPlatform={platform}><Harness chatFind={chatFind} /></KeyboardShortcutsProvider>);
  const composer = screen.getByRole('textbox', { name: 'composer' });
  act(() => composer.focus());
  const side = view.container.querySelector<HTMLElement>('[data-content-find-scope="side"]')!;
  const bottom = view.container.querySelector<HTMLElement>('[data-content-find-scope="bottom"]')!;
  fireEvent.pointerDown(side.querySelector('diffs-container')!);
  expect(document.activeElement).toBe(composer);
  const pressFind = () => fireEvent.keyDown(document.activeElement!, { key: 'f', code: 'KeyF', ctrlKey: platform === 'win32', metaKey: platform === 'darwin' });
  pressFind();
  const sideInput = within(side).getByRole('textbox', { name: '搜索当前面板内容' });
  fireEvent.change(sideInput, { target: { value: 'needle' } });
  expect(within(side).getByRole('status').textContent).toBe('第 1 项，共 2 项');
  fireEvent.keyDown(sideInput, { key: 'Enter' });
  expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'side-file', lineNumber: 200 }));
  await waitFor(() => expect(activeRanges()[0]?.startContainer.parentElement?.dataset.line).toBe('200'));
  expect(activeRanges()[0].toString()).toBe('needle');
  fireEvent.pointerDown(screen.getByRole('button', { name: 'menu' }));
  pressFind();
  expect(chatFind).not.toHaveBeenCalled();

  // Opening and closing another pane must preserve the first pane's matches.
  fireEvent.pointerDown(bottom.querySelector('diffs-container')!);
  pressFind();
  const bottomInput = within(bottom).getByRole('textbox', { name: '搜索当前面板内容' });
  fireEvent.change(bottomInput, { target: { value: 'bottom' } });
  expect(activeRanges()).toHaveLength(2);
  fireEvent.keyDown(bottomInput, { key: 'Escape' });
  expect(within(bottom).queryByRole('search')).toBeNull();
  expect(activeRanges()).toHaveLength(1);
  expect(activeRanges()[0].toString()).toBe('needle');
  act(() => sideInput.focus());
  fireEvent.keyDown(sideInput, { key: 'Escape' });
  expect(highlights.size).toBe(0);

  fireEvent.pointerDown(composer);
  act(() => composer.focus());
  pressFind();
  expect(chatFind).toHaveBeenCalledOnce();
});

function activeRanges() { return [...(highlights.get('content-find-active') ?? [])]; }

const sideContent = ['first needle', ...Array.from({ length: 198 }, () => 'other'), 'last needle'].join('\n');
function Harness({ chatFind }: { chatFind(): void }) {
  const request = useContentFindTarget();
  useAppKeyboardShortcuts({ 'chat.find': { execute: (event) => {
    if (!request(event && 'target' in event ? event : undefined)) chatFind();
  } } });
  return <>
    <input aria-label="composer" />
    <button aria-haspopup="menu">menu</button>
    <WorkspaceContentFind placement="side"><VirtualFile id="side-file" content={sideContent} /></WorkspaceContentFind>
    <WorkspaceContentFind placement="bottom"><VirtualFile id="bottom-file" content="bottom" /></WorkspaceContentFind>
  </>;
}

/** Fake only Pierre's viewport: keep one line mounted and expose its scroll API. */
function VirtualFile({ id, content }: { id: string; content: string }) {
  const [line, setLine] = useState(1);
  const hostRef = useRef<HTMLElement | null>(null);
  const codeViewRef = useRef({ scrollTo: (target) => {
    navigate(target);
    if (target.type === 'line') setLine(target.lineNumber);
  } } as CodeViewHandle<undefined>);
  const containerRef = useCodeViewFind(codeViewRef, id, content);
  useEffect(() => {
    const host = hostRef.current!;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const row = document.createElement('div');
    row.dataset.line = String(line);
    row.dataset.lineType = 'context';
    row.textContent = content.split('\n')[line - 1];
    shadow.replaceChildren(row);
  }, [content, line]);
  return <div ref={containerRef}>{createElement('diffs-container', { ref: hostRef })}</div>;
}
