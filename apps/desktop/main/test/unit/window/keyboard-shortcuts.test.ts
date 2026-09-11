import { EventEmitter } from 'node:events';
import type { Input, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerWindowKeyboardShortcuts } from '../../../src/window/keyboard-shortcuts.js';

describe('window keyboard shortcuts', () => {
  it('lets registered shortcuts reach the page without triggering native menu actions', () => {
    const contents = Object.assign(new EventEmitter(), { setIgnoreMenuShortcuts: vi.fn() });
    const shortcuts = registerWindowKeyboardShortcuts(contents as unknown as WebContents);
    const event = { preventDefault: vi.fn() };
    const input: Input = {
      type: 'keyDown', key: 'w', code: 'KeyW', meta: true, control: false,
      alt: false, shift: false, isAutoRepeat: false, isComposing: false, modifiers: ['meta'], location: 0,
    };
    shortcuts.setActiveBindings(['Meta+KeyW']);

    contents.emit('before-input-event', event, input);
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    expect(event.preventDefault).not.toHaveBeenCalled();

    contents.emit('before-input-event', event, { ...input, code: 'KeyC' });
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);

    shortcuts.setActiveBindings([]);
    contents.emit('before-input-event', event, input);
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);

    shortcuts.setRecording(true);
    contents.emit('before-input-event', event, { ...input, code: 'KeyQ' });
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    shortcuts.setRecording(false);
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);

    contents.emit('destroyed');
    expect(contents.listenerCount('before-input-event')).toBe(0);
  });
});
