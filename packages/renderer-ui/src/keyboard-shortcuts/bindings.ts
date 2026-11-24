export const KEYBOARD_SHORTCUT_PLATFORMS = ['darwin', 'win32'] as const;
export type KeyboardShortcutPlatform = typeof KEYBOARD_SHORTCUT_PLATFORMS[number];
export type KeyboardShortcutConflict<Id extends string> = Readonly<{ commandId: Id; binding: string }>;

const keyboardShortcutModifiers = ['Control', 'Alt', 'Shift', 'Meta'] as const;

type KeyboardShortcutModifier = typeof keyboardShortcutModifiers[number];

export type KeyboardShortcutCaptureError =
  | 'alt-graph'
  | 'modifier-required'
  | 'reserved'
  | 'unsupported';

export type KeyboardShortcutCaptureResult =
  | { status: 'captured'; binding: string }
  | { status: 'pending' }
  | { status: 'invalid'; reason: KeyboardShortcutCaptureError };

export type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
> & {
  altGraph?: boolean;
  getModifierState?: (keyArg: string) => boolean;
};

const modifierCodePattern = /^(?:Alt|Control|Meta|Shift)(?:Left|Right)$/u;
const functionKeyPattern = /^F(?:[1-9]|1\d|2[0-4])$/u;
const supportedCodePattern = /^(?:Key[A-Z]|Digit\d|Numpad[A-Za-z0-9]+|F(?:[1-9]|1\d|2[0-4])|Arrow(?:Up|Down|Left|Right)|Backquote|Backslash|BracketLeft|BracketRight|Comma|Period|Minus|Equal|Semicolon|Quote|Slash|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/u;
const unmodifiedCodePattern = /^(?:Key[A-Z]|Digit\d|Numpad[A-Za-z0-9]+|Backquote|Backslash|BracketLeft|BracketRight|Comma|Period|Minus|Equal|Semicolon|Quote|Slash)$/u;

const displayKeyByCode: Record<string, string> = {
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  Backquote: '`',
  Backslash: '\\',
  Backspace: 'Backspace',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Equal: '=',
  Home: 'Home',
  Insert: 'Insert',
  Minus: '-',
  PageDown: 'Page Down',
  PageUp: 'Page Up',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Space: 'Space',
  Tab: 'Tab',
};

export function normalizeKeyboardShortcutBinding(value: unknown, allowUnmodifiedKeys = false): string | null {
  if (typeof value !== 'string') return null;
  const tokens = value.split('+').map((token) => token.trim()).filter(Boolean);
  const code = tokens.at(-1);
  if (!code || !supportedCodePattern.test(code)) return null;

  const modifiers = new Set<KeyboardShortcutModifier>();
  for (const token of tokens.slice(0, -1)) {
    if (!isKeyboardShortcutModifier(token) || modifiers.has(token)) return null;
    modifiers.add(token);
  }
  if (!allowUnmodifiedKeys && !modifiers.size && !functionKeyPattern.test(code)) return null;
  return keyboardShortcutBinding([...modifiers], code);
}

function keyboardShortcutBinding(
  modifiers: readonly KeyboardShortcutModifier[],
  code: string,
): string {
  const activeModifiers = new Set(modifiers);
  return [
    ...keyboardShortcutModifiers.filter((modifier) => activeModifiers.has(modifier)),
    code,
  ].join('+');
}

export function captureKeyboardShortcut(
  event: KeyboardShortcutEvent,
  platform: KeyboardShortcutPlatform,
  allowUnmodifiedKeys = false,
): KeyboardShortcutCaptureResult {
  if (event.altGraph || event.getModifierState?.('AltGraph')) return { status: 'invalid', reason: 'alt-graph' };
  if (!event.code || event.code === 'Unidentified') return { status: 'invalid', reason: 'unsupported' };
  if (modifierCodePattern.test(event.code)) return { status: 'pending' };
  if (!supportedCodePattern.test(event.code)) return { status: 'invalid', reason: 'unsupported' };

  const binding = keyboardShortcutBinding(activeModifiers(event), event.code);
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !functionKeyPattern.test(event.code)) {
    if (!allowUnmodifiedKeys || !unmodifiedCodePattern.test(event.code)) return { status: 'invalid', reason: 'modifier-required' };
  }
  if (isReservedKeyboardShortcut(binding, platform) || (allowUnmodifiedKeys && binding === 'Shift+F10')) {
    return { status: 'invalid', reason: 'reserved' };
  }
  return { status: 'captured', binding };
}

export function keyboardEventMatchesBinding(
  event: KeyboardShortcutEvent,
  binding: string,
): boolean {
  const normalized = normalizeKeyboardShortcutBinding(binding);
  return normalized !== null && normalized === keyboardShortcutFromEvent(event);
}

export function keyboardShortcutFromEvent(event: KeyboardShortcutEvent, code = event.code): string | null {
  if (event.altGraph || event.getModifierState?.('AltGraph')) return null;
  return keyboardShortcutBinding(activeModifiers(event), code);
}

export function formatKeyboardShortcutBinding(
  binding: string,
  platform: KeyboardShortcutPlatform,
  accessible = false,
): string {
  const normalized = normalizeKeyboardShortcutBinding(binding, true);
  if (!normalized) return binding;
  const modifiers = bindingModifiers(normalized);
  const codeLabel = displayKeyLabel(bindingCode(normalized));

  if (platform === 'darwin') {
    const labels = accessible
      ? { Control: 'Control', Alt: 'Option', Shift: 'Shift', Meta: 'Command' }
      : { Control: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
    return accessible
      ? [...modifiers.map((modifier) => labels[modifier]), codeLabel].join(' + ')
      : `${modifiers.map((modifier) => labels[modifier]).join('')}${codeLabel}`;
  }

  const labels = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };
  return [...modifiers.map((modifier) => labels[modifier]), codeLabel].join('+');
}

export function formatKeyboardShortcutBindingParts(
  binding: string,
  platform: KeyboardShortcutPlatform,
): string[] {
  const normalized = normalizeKeyboardShortcutBinding(binding, true);
  if (!normalized) return [binding];
  const modifiers = bindingModifiers(normalized);
  const codeLabel = displayKeyLabel(bindingCode(normalized));
  if (platform === 'darwin') {
    const labels = { Control: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
    return [...modifiers.map((modifier) => labels[modifier]), codeLabel];
  }
  const labels = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };
  return [...modifiers.map((modifier) => labels[modifier]), codeLabel];
}

function bindingCode(binding: string): string {
  return binding.split('+').at(-1) ?? '';
}

function bindingModifiers(binding: string): KeyboardShortcutModifier[] {
  return binding.split('+').slice(0, -1).filter(isKeyboardShortcutModifier);
}

function activeModifiers(event: KeyboardShortcutEvent): KeyboardShortcutModifier[] {
  return keyboardShortcutModifiers.filter((modifier) => {
    if (modifier === 'Control') return event.ctrlKey;
    if (modifier === 'Alt') return event.altKey;
    if (modifier === 'Shift') return event.shiftKey;
    return event.metaKey;
  });
}

function isKeyboardShortcutModifier(value: string): value is KeyboardShortcutModifier {
  return keyboardShortcutModifiers.includes(value as KeyboardShortcutModifier);
}

function displayKeyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return displayKeyByCode[code] ?? code;
}

function isReservedKeyboardShortcut(binding: string, platform: KeyboardShortcutPlatform): boolean {
  if (platform === 'darwin') {
    return new Set([
      'Meta+Digit0',
      'Meta+Equal',
      'Meta+Minus',
      'Meta+KeyA',
      'Meta+KeyC',
      'Meta+KeyH',
      'Meta+KeyM',
      'Meta+KeyQ',
      'Meta+KeyR',
      'Meta+KeyV',
      'Meta+KeyX',
      'Meta+KeyZ',
      'Meta+Backquote',
      'Meta+Space',
      'Meta+Tab',
      'Alt+Meta+KeyH',
      'Alt+Meta+KeyI',
      'Alt+Shift+Meta+KeyV',
      'Shift+Meta+Digit3',
      'Shift+Meta+Digit4',
      'Shift+Meta+Digit5',
      'Shift+Meta+Equal',
      'Shift+Meta+KeyR',
      'Shift+Meta+KeyV',
      'Shift+Meta+KeyZ',
      'Shift+Meta+Tab',
      'Control+Meta+KeyF',
      'Control+Meta+KeyQ',
      'Control+Meta+Space',
    ]).has(binding);
  }
  return bindingModifiers(binding).includes('Meta')
    || binding === 'Alt+F4'
    || binding === 'Alt+Space'
    || binding === 'Alt+Tab'
    || binding === 'Alt+Shift+Tab'
    || binding === 'Control+Alt+Delete';
}
