export const computerNavigationKeys = ['Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space'] as const;
export const computerModifiers = ['Meta', 'Control', 'Alt', 'Shift'] as const;
export type ComputerModifier = typeof computerModifiers[number];

// Ctrl+Shift+Esc belongs to Task Manager on Windows and cannot be registered by Electron.
export const computerStopShortcuts = {
  win32: { accelerator: 'Control+Alt+Shift+Escape', label: 'Ctrl + Alt + Shift + Esc' },
  darwin: { accelerator: 'Command+Shift+Escape', label: '⌘ + Shift + Esc' },
} as const;

export function parseComputerKeystroke(key: unknown, modifiers: unknown): { key: string; modifiers?: ComputerModifier[] } {
  if (typeof key !== 'string' || (!computerNavigationKeys.includes(key as typeof computerNavigationKeys[number]) && !/^[a-zA-Z0-9]$/u.test(key))) {
    throw new Error('Unsupported desktop key. Use a letter, digit or named navigation key; pass shortcuts as key plus modifiers.');
  }
  const normalized = key.length === 1 ? key.toLowerCase() : key;
  if (modifiers === undefined) return { key: normalized };
  if (!Array.isArray(modifiers) || modifiers.length > 4 || new Set(modifiers).size !== modifiers.length
    || modifiers.some((value) => !computerModifiers.includes(value))) throw new Error('Invalid desktop modifiers. Use Meta, Control, Alt or Shift without duplicates.');
  return { key: normalized, modifiers: [...modifiers] };
}
