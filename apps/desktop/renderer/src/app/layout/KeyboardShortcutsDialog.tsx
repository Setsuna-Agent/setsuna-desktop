import { Dialog, TextField } from '@setsuna-desktop/renderer-ui';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useKeyboardShortcuts } from '../../shared/shortcuts/KeyboardShortcutsProvider.js';
import { formatKeyboardShortcutBinding } from '../../shared/shortcuts/keyboardShortcutBindings.js';
import { KEYBOARD_SHORTCUT_GROUPS } from '../../shared/shortcuts/keyboardShortcutCommands.js';
import { searchKeyboardShortcuts } from '../../shared/shortcuts/keyboardShortcutSearch.js';
import '../styles/shortcuts.css';

export function KeyboardShortcutsDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const { bindingsFor, platform } = useKeyboardShortcuts();
  const [query, setQuery] = useState('');
  const commands = useMemo(() => searchKeyboardShortcuts(query, { bindingsFor, platform, translate: t })
    .filter((command) => bindingsFor(command.id).length > 0), [bindingsFor, platform, query, t]);

  return (
    <Dialog title={t('settings.section.shortcuts')} className="app-shortcuts-dialog" width={600} onClose={onClose}>
      <label className="app-shortcuts__search">
        <Search size={14} aria-hidden="true" />
        <TextField type="search" autoFocus value={query} aria-label={t('shortcuts.search')}
          placeholder={t('shortcuts.search')} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="app-shortcuts__list" tabIndex={0}>
        {commands.length ? KEYBOARD_SHORTCUT_GROUPS.map((group) => {
          const items = commands.filter((command) => command.group === group);
          if (!items.length) return null;
          return <section className="app-shortcuts__group" key={group}>
            <h2>{t(`shortcuts.group.${group}`)}</h2>
            <dl>
              {items.map((command) => <div className="app-shortcuts__row" key={command.id}>
                <dt>{t(command.labelKey)}</dt>
                <dd>{bindingsFor(command.id).map((binding) => (
                  <kbd key={binding} aria-label={formatKeyboardShortcutBinding(binding, platform, true)}>
                    {formatKeyboardShortcutBinding(binding, platform)}
                  </kbd>
                ))}</dd>
              </div>)}
            </dl>
          </section>;
        }) : <p className="app-shortcuts__empty">{t('shortcuts.emptySearch')}</p>}
      </div>
    </Dialog>
  );
}
