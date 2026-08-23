import type { DesktopKeyboardShortcutInput } from '@setsuna-desktop/contracts';
import type { Input } from 'electron';

export type EmbeddedBrowserKeyboardShortcut = {
  binding: string;
  input: DesktopKeyboardShortcutInput;
};

export function embeddedBrowserKeyboardShortcut(
  input: Input,
  activeBindings: ReadonlySet<string>,
): EmbeddedBrowserKeyboardShortcut | null {
  if (
    input.type !== 'keyDown'
    || input.isAutoRepeat
    || input.isComposing
    || input.key === 'Process'
    || !input.code
  ) return null;

  const altGraph = input.key === 'AltGraph' || input.modifiers.some((modifier) => {
    const normalized = modifier.toLowerCase();
    return normalized === 'altgr' || normalized === 'altgraph';
  });
  if (altGraph) return null;

  const binding = [
    input.control ? 'Control' : null,
    input.alt ? 'Alt' : null,
    input.shift ? 'Shift' : null,
    input.meta ? 'Meta' : null,
    input.code,
  ].filter(Boolean).join('+');
  if (!activeBindings.has(binding)) return null;

  return {
    binding,
    input: {
      altGraph,
      altKey: input.alt,
      code: input.code,
      ctrlKey: input.control,
      isComposing: input.isComposing,
      key: input.key,
      metaKey: input.meta,
      repeat: input.isAutoRepeat,
      shiftKey: input.shift,
    },
  };
}
