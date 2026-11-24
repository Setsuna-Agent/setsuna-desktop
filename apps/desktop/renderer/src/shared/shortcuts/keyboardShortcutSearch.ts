import type { AppMessageKey, Translate } from '../i18n/I18nProvider.js';
import { formatKeyboardShortcutBinding } from '@setsuna-desktop/renderer-ui';
import type { KeyboardShortcutPlatform } from './keyboardShortcutCommands.js';

export type SearchableShortcut<Id extends string> = {
  id: Id;
  labelKey: AppMessageKey;
  descriptionKey?: AppMessageKey;
};

/** Search the effective bindings, including readable modifier names on macOS. */
export function searchKeyboardShortcuts<Command extends SearchableShortcut<string>>(commands: readonly Command[], query: string, {
  bindingsFor, platform, translate,
}: {
  bindingsFor(commandId: Command['id']): readonly string[];
  platform: KeyboardShortcutPlatform;
  translate: Translate;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return commands;
  return commands.filter((command) => [
    translate(command.labelKey),
    command.descriptionKey ? translate(command.descriptionKey) : '',
    ...bindingsFor(command.id).flatMap((binding) => [
      formatKeyboardShortcutBinding(binding, platform),
      formatKeyboardShortcutBinding(binding, platform, true),
    ]),
  ].join(' ').toLocaleLowerCase().includes(normalizedQuery));
}
