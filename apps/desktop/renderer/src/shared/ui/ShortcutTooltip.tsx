import type { ReactNode } from 'react';
import {
  formatKeyboardShortcutBinding,
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
          {bindings.map((binding) => (
            <kbd key={binding}>{formatKeyboardShortcutBinding(binding, platform)}</kbd>
          ))}
        </span>
      ) : null}
    </span>
  );
}
