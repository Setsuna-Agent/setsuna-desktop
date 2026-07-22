import type { DesktopBrowserKeyModifier } from '@setsuna-desktop/contracts';
import type { KeyboardInputEvent, WebContents } from 'electron';

export type NativeBrowserKeyOptions = {
  key: string;
  modifiers: DesktopBrowserKeyModifier[];
  repeat: number;
};

type NativeInputModifier = NonNullable<KeyboardInputEvent['modifiers']>[number];

const keyCodeAliases: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  Space: 'Space',
};

const nativeModifierByBrowserModifier: Record<DesktopBrowserKeyModifier, NativeInputModifier> = {
  Alt: 'alt',
  Control: 'control',
  Meta: 'meta',
  Shift: 'shift',
};

/**
 * 向 Electron guest 发送原生键盘事件。
 * 无目标的按键必须走 WebContents 输入通道；CDP 仅用于有明确 frame/元素目标的输入。
 */
export function dispatchNativeBrowserKey(
  contents: WebContents,
  options: NativeBrowserKeyOptions,
  signal?: AbortSignal,
): string {
  const keyCode = electronKeyCode(options.key);
  const modifiers = options.modifiers.map((modifier) => nativeModifierByBrowserModifier[modifier]);

  for (let index = 0; index < options.repeat; index += 1) {
    throwIfAborted(signal);
    contents.sendInputEvent({ keyCode, modifiers, type: 'rawKeyDown' });
    contents.sendInputEvent({ keyCode, modifiers, type: 'keyUp' });
  }

  const chord = `${options.modifiers.length ? `${options.modifiers.join('+')}+` : ''}${options.key}`;
  return `Dispatched ${chord}${options.repeat > 1 ? ` ${options.repeat} times` : ''} using Electron native keyboard input.`;
}

function electronKeyCode(rawKey: string): string {
  const alias = keyCodeAliases[rawKey];
  if (alias) return alias;
  if ([...rawKey].length !== 1) {
    const supportedNamedKeys = new Set([
      'Backspace',
      'Delete',
      'End',
      'Enter',
      'Escape',
      'Home',
      'PageDown',
      'PageUp',
      'Tab',
    ]);
    if (!supportedNamedKeys.has(rawKey)) throw new Error(`Unsupported browser key: ${rawKey}`);
  }
  return /^[a-z]$/i.test(rawKey) ? rawKey.toUpperCase() : rawKey;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Browser operation was cancelled.');
  }
}
