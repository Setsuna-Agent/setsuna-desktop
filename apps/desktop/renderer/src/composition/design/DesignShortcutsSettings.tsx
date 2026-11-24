import type { DesignShortcutSettingsProps } from '@setsuna-desktop/feature-design/renderer';
import { KeyboardShortcutEditor } from '../../features/settings/shortcuts/KeyboardShortcutsSettings.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useKeyboardShortcuts } from '../../shared/shortcuts/KeyboardShortcutsProvider.js';
import { keyboardShortcutCommand } from '../../shared/shortcuts/keyboardShortcutCommands.js';
import './design-shortcuts-settings.css';

export default function DesignShortcutsSettings({ isClipboardBinding, ...shortcuts }: DesignShortcutSettingsProps) {
  const { t } = useI18n();
  const { commandForBinding } = useKeyboardShortcuts();
  return <KeyboardShortcutEditor {...shortcuts} className="design-settings-shortcuts" allowUnmodifiedKeys
    resetConfirmationTitle={t('feature.design.settings.resetShortcuts')}
    blockedBindingReason={(binding) => {
      if (isClipboardBinding(binding)) return t('feature.design.settings.clipboardShortcut');
      const command = commandForBinding(binding);
      return command ? t('feature.design.settings.appShortcut', { command: t(keyboardShortcutCommand(command).labelKey) }) : undefined;
    }} />;
}
