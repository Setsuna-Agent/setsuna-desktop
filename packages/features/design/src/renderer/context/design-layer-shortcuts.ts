import { formatKeyboardShortcutBinding, keyboardShortcutFromEvent, type KeyboardShortcutEvent,
  type KeyboardShortcutPlatform } from '@setsuna-desktop/renderer-ui';

const clipboardKeys = { copy: 'KeyC', paste: 'KeyV' } as const;

export function designClipboardCommand(binding: string | null): keyof typeof clipboardKeys | undefined {
  switch (binding) {
    case 'Control+KeyC': case 'Meta+KeyC': case 'Control+Meta+KeyC': return 'copy';
    case 'Control+KeyV': case 'Meta+KeyV': case 'Control+Meta+KeyV': return 'paste';
  }
}

export function designClipboardShortcut(event: KeyboardShortcutEvent) {
  return designClipboardCommand(keyboardShortcutFromEvent(event));
}

export function designClipboardLabel(command: keyof typeof clipboardKeys, platform: KeyboardShortcutPlatform) {
  const modifier = platform === 'darwin' ? 'Meta' : 'Control';
  return formatKeyboardShortcutBinding(`${modifier}+${clipboardKeys[command]}`, platform);
}
