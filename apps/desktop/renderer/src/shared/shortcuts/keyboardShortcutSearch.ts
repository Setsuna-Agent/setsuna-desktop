import type { Translate } from '../i18n/I18nProvider.js';
import { formatKeyboardShortcutBinding } from './keyboardShortcutBindings.js';
import {
  keyboardShortcutCommands,
  type KeyboardShortcutCommandId,
  type KeyboardShortcutPlatform,
} from './keyboardShortcutCommands.js';

/** Search the effective bindings, including readable modifier names on macOS. */
export function searchKeyboardShortcuts(query: string, {
  bindingsFor, platform, translate,
}: {
  bindingsFor(commandId: KeyboardShortcutCommandId): readonly string[];
  platform: KeyboardShortcutPlatform;
  translate: Translate;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return keyboardShortcutCommands;
  return keyboardShortcutCommands.filter((command) => [
    translate(command.labelKey),
    translate(command.descriptionKey),
    ...bindingsFor(command.id).flatMap((binding) => [
      formatKeyboardShortcutBinding(binding, platform),
      formatKeyboardShortcutBinding(binding, platform, true),
    ]),
  ].join(' ').toLocaleLowerCase().includes(normalizedQuery));
}
