import type { DesignLayerCommand } from './design-layer-commands.js';

type ShortcutInput = Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>;

export function designLayerShortcut(event: ShortcutInput): DesignLayerCommand | undefined {
  const primary = event.metaKey || event.ctrlKey;
  const { altKey, shiftKey, code } = event;
  if (primary) {
    if (code === 'KeyC' && !altKey && !shiftKey) return 'copy';
    if (code === 'KeyV' && !altKey && !shiftKey) return 'paste';
    if (code === 'KeyR' && altKey && !shiftKey) return 'replace';
    if (code === 'KeyG') return shiftKey ? 'ungroup' : altKey ? 'frame' : 'group';
    if (code === 'KeyK' && altKey && !shiftKey) return 'component';
    return;
  }
  if (shiftKey && code === 'KeyA') return altKey ? 'removeLayout' : 'addLayout';
  if (altKey) return;
  if (shiftKey && code === 'KeyH') return 'flipX';
  if (shiftKey && code === 'KeyV') return 'flipY';
  if (!shiftKey && code === 'BracketRight') return 'front';
  if (!shiftKey && code === 'BracketLeft') return 'back';
  if (!shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) return 'delete';
}

export function designLayerShortcutLabel(command: DesignLayerCommand, mac: boolean): string | undefined {
  const primary = mac ? '⌘' : 'Ctrl+';
  const alt = mac ? '⌥' : 'Alt+';
  const shift = mac ? '⇧' : 'Shift+';
  const labels: Partial<Record<DesignLayerCommand, string>> = {
    copy: `${primary}C`, paste: `${primary}V`, replace: `${primary}${alt}R`, front: ']', back: '[',
    group: `${primary}G`, frame: `${primary}${alt}G`, ungroup: `${primary}${shift}G`,
    addLayout: `${shift}A`, removeLayout: `${shift}${alt}A`, component: `${primary}${alt}K`,
    flipX: `${shift}H`, flipY: `${shift}V`, delete: mac ? '⌫' : 'Del',
  };
  return labels[command];
}
