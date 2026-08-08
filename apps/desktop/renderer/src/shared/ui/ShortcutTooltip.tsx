import type { ReactNode } from 'react';
import {
  formatKeyboardShortcutBinding,
  formatKeyboardShortcutBindingParts,
} from '../shortcuts/keyboardShortcutBindings.js';
import type { KeyboardShortcutCommandId } from '../shortcuts/keyboardShortcutCommands.js';
import { useKeyboardShortcuts } from '../shortcuts/KeyboardShortcutsProvider.js';
import { AppTooltip } from './primitives.js';

export function ShortcutTooltip({
  children,
  commandId,
  label,
  placement = 'top',
}: {
  children: ReactNode;
  commandId: KeyboardShortcutCommandId;
  label: string;
  placement?: 'top' | 'bottom' | 'bottomRight';
}) {
  return (
    <AppTooltip placement={placement} title={<ShortcutTooltipContent commandId={commandId} label={label} />}>
      <span className="sd-shortcut-tooltip-target" role="none">{children}</span>
    </AppTooltip>
  );
}

export function ShortcutTooltipContent({
  commandId,
  label,
}: {
  commandId: KeyboardShortcutCommandId;
  label: string;
}) {
  const { bindingsFor, platform } = useKeyboardShortcuts();
  const bindings = bindingsFor(commandId);
  return (
    <span className="sd-shortcut-tooltip-content">
      <span>{label}</span>
      {bindings.length ? (
        <span className="sd-shortcut-tooltip-bindings" aria-label={bindings
          .map((binding) => formatKeyboardShortcutBinding(binding, platform, true))
          .join(', ')}>
          {bindings.map((binding) => {
            const label = formatKeyboardShortcutBinding(binding, platform);
            return (
              <kbd className={platform === 'darwin' ? 'is-mac' : undefined} key={binding}>
                {platform === 'darwin'
                  ? formatKeyboardShortcutBindingParts(binding, platform).map((part, index) => (
                    <span key={`${part}:${index}`}>{part}</span>
                  ))
                  : label}
              </kbd>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}
