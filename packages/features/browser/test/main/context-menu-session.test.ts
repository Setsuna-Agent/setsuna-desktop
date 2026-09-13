import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { BrowserContextMenuSession } from '../../src/main/context-menu-session.js';

function guest() {
  return Object.assign(new EventEmitter(), { id: 42, isDestroyed: () => false, focus: vi.fn() }) as unknown as WebContents;
}

describe('browser menu action sessions', () => {
  it('runs only enabled actions from the current menu, once', () => {
    const publish = vi.fn();
    const session = new BrowserContextMenuSession(publish);
    const contents = guest();
    const copy = vi.fn();
    const remove = vi.fn();
    session.show(contents, [{ label: 'Copy', click: copy }, { label: 'Delete', enabled: false, click: remove }], { x: 80, y: 120 });
    const first = publish.mock.calls.at(-1)![0];
    expect(JSON.parse(JSON.stringify(first))).toEqual({
      id: first.id, webContentsId: 42, x: 80, y: 120,
      items: [{ key: '0', label: 'Copy', disabled: false }, { key: '1', label: 'Delete', disabled: true }],
    });
    expect(session.execute(first.id, '1')).toBe(false);
    session.show(contents, [{ label: 'Copy', click: copy }], { x: 90, y: 130 });
    const second = publish.mock.calls.at(-1)![0];
    session.dismiss(first.id);
    expect(session.execute(first.id, '0')).toBe(false);
    expect(session.execute(second.id, '0')).toBe(true);
    expect(session.execute(second.id, '0')).toBe(false);
    expect(copy).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(contents.focus).toHaveBeenCalledOnce();
    expect(contents.listenerCount('did-start-navigation')).toBe(0);
  });

  it.each(['did-start-navigation', 'destroyed'] as const)('invalidates the menu when the guest emits %s', (event) => {
    const publish = vi.fn();
    const session = new BrowserContextMenuSession(publish);
    const contents = guest();
    const action = vi.fn();
    session.show(contents, [{ label: 'Paste', click: action }], { x: 0, y: 0 });
    const request = publish.mock.calls.at(-1)![0];
    contents.emit(event);
    expect(publish).toHaveBeenLastCalledWith(null);
    expect(session.execute(request.id, '0')).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(contents.listenerCount('destroyed')).toBe(0);
  });
});
