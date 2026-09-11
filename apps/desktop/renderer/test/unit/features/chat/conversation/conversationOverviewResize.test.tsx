// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationOverviewLayout } from '../../../../../src/features/chat/conversation/ChatWorkspaceScroll.js';

const observers = new Set<{ nodes: Set<Element>; notify(): void }>();

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    nodes = new Set<Element>();
    notify: () => void;
    constructor(notify: () => void) { this.notify = notify; observers.add(this); }
    observe(node: Element) { this.nodes.add(node); }
    disconnect() { this.nodes.clear(); observers.delete(this); }
  });
  // Layout dimensions are CSS pixels; the painted rectangles include page zoom.
  const width = function (this: HTMLElement) { return Number(this.dataset.width ?? 0); };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(width);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(width);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: width.call(this) * 1.5 } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('starts observing late content, follows window and panel resizing, and rebinds when the content node changes', () => {
  const view = render(<Harness contentKey={null} />);
  expect(observers.size).toBe(0);
  expect(layout()).toBe('hidden');

  view.rerender(<Harness contentKey="starter" />);
  expect(observers.size).toBe(1);
  expect(layout()).toBe('shifted');
  const container = screen.getByTestId('conversation');
  const originalContent = screen.getByTestId('content');
  expect([...observers].every((observer) => observer.nodes.has(originalContent))).toBe(true);

  act(() => {
    container.dataset.width = '1163';
    window.dispatchEvent(new Event('resize'));
  });
  expect(layout()).toBe('hidden');

  act(() => {
    container.dataset.width = '900';
    for (const observer of observers) observer.notify();
  });
  expect(layout()).toBe('hidden');

  view.rerender(<Harness contentKey="transcript" />);
  const replacement = screen.getByTestId('content');
  expect(replacement).not.toBe(originalContent);
  expect([...observers].every((observer) => observer.nodes.has(replacement) && !observer.nodes.has(originalContent))).toBe(true);
  act(() => {
    container.dataset.width = '1300';
    for (const observer of observers) observer.notify();
  });
  expect(layout()).toBe('shifted');
  act(() => {
    container.dataset.width = '1600';
    for (const observer of observers) observer.notify();
  });
  expect(layout()).toBe('centered');
  view.rerender(<Harness contentKey={null} />);
  expect(layout()).toBe('hidden');
  view.unmount();
  expect(observers.size).toBe(0);
});

function Harness({ contentKey }: { contentKey: string | null }) {
  const conversationRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const overviewLayout = useConversationOverviewLayout(conversationRef, content);
  return <div ref={conversationRef} data-testid="conversation" data-width="1300">
    {contentKey ? <div key={contentKey} ref={setContent} data-testid="content" data-width="750" /> : null}
    <output>{overviewLayout}</output>
  </div>;
}

function layout() {
  return screen.getByRole('status').textContent;
}
