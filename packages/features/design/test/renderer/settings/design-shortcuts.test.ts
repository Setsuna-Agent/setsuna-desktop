import { expect, it } from 'vitest';
import { createDesignShortcuts } from '../../../src/renderer/settings/design-shortcuts.js';

const azertyZ = { key: 'z', code: 'KeyW', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };

it.each(['win32', 'darwin'] as const)('matches default undo and redo by character on %s', (platform) => {
  const shortcuts = createDesignShortcuts({}, platform);
  const undo = { ...azertyZ, ctrlKey: platform === 'win32', metaKey: platform === 'darwin' };
  expect(shortcuts.match(undo)?.id).toBe('undo');
  expect(shortcuts.match({ ...undo, key: 'Z', shiftKey: true })?.id).toBe('redo');
  expect(shortcuts.match({ ...undo, key: 'w', code: 'KeyZ' })).toBeUndefined();
  expect(shortcuts.match({ ...undo, key: 'п', code: 'KeyG' })?.id).toBe('layer.group');
  expect(shortcuts.match({ ...undo, key: 'Ф', code: 'KeyA', ctrlKey: false, metaKey: false, shiftKey: true })?.id).toBe('layer.addLayout');
});

it('gives the recorded physical binding priority over the default character', () => {
  const shortcuts = createDesignShortcuts({ duplicate: ['Control+KeyW'] }, 'win32');
  expect(shortcuts.match(azertyZ)?.id).toBe('duplicate');
  expect(shortcuts.match({ ...azertyZ, key: 'w', code: 'KeyZ' })).toBeUndefined();
  expect(shortcuts.match({ ...azertyZ, key: 'w', code: '' })).toBeUndefined();
});

it('zooms with punctuation on other physical keys and respects custom bindings', () => {
  const event = { ...azertyZ, key: '+', code: 'BracketRight', ctrlKey: false };
  const shortcuts = createDesignShortcuts({}, 'win32');
  expect(shortcuts.match(event)?.id).toBe('zoomIn');
  expect(shortcuts.match({ ...event, shiftKey: true })?.id).toBe('zoomIn');
  expect(shortcuts.match({ ...event, key: '-', code: 'BracketLeft' })?.id).toBe('zoomOut');
  expect(shortcuts.match({ ...event, key: ']' })?.id).toBe('layer.front');
  expect(shortcuts.match({ ...event, key: ')', code: 'Equal' })).toBeUndefined();
  expect(createDesignShortcuts({ 'layer.back': ['BracketRight'] }, 'win32').match(event)?.id).toBe('layer.back');
  expect(createDesignShortcuts({ zoomIn: ['NumpadAdd'] }, 'win32').match(event)).toBeUndefined();
});

it('keeps the character binding when another default for the same command is removed', () => {
  const shortcuts = createDesignShortcuts({ redo: ['Control+Shift+KeyZ', 'Control+KeyU'] }, 'win32');
  expect(shortcuts.match({ ...azertyZ, key: 'Z', shiftKey: true })?.id).toBe('redo');
  expect(shortcuts.match({ ...azertyZ, key: 'W', code: 'KeyZ', shiftKey: true })).toBeUndefined();
  expect(shortcuts.match({ ...azertyZ, key: 'y', code: 'KeyY' })).toBeUndefined();
  expect(shortcuts.match({ ...azertyZ, key: 'h', code: 'KeyU' })?.id).toBe('redo');
});
