import { capabilitiesSidebarSlot } from '@setsuna-desktop/renderer-contracts/capabilities';
import type { SettingsPageEntryDescriptor } from '@setsuna-desktop/renderer-contracts/settings';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { RendererOwnedSingleSlot } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { settingsViewUi } from '../../shared/ui/SettingsViewUi.js';
import { Button, IconButton, TextField } from '../../shared/ui/primitives.js';

export function CapabilitiesSidebar({
  entries,
  activeSectionId,
  selectedPluginId,
  onOpenSection,
}: Readonly<{
  entries: readonly SettingsPageEntryDescriptor[];
  activeSectionId: string;
  selectedPluginId: string | null;
  onOpenSection(sectionId: string, itemId?: string): void;
}>) {
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    searchTriggerRef.current?.focus();
  };

  return (
    <aside className="app-sidebar capabilities-sidebar" aria-label={t('capabilities.sidebar.title')}>
      <div className="capabilities-sidebar__header">
        <h2>{t('capabilities.sidebar.title')}</h2>
        <IconButton
          ref={searchTriggerRef}
          label={t('capabilities.sidebar.search')}
          aria-expanded={searchOpen}
          onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}
        >
          <Search size={15} />
        </IconButton>
      </div>
      {searchOpen ? (
        <TextField
          autoFocus
          className="capabilities-sidebar__search"
          aria-label={t('capabilities.sidebar.search')}
          placeholder={t('capabilities.sidebar.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeSearch();
          }}
        />
      ) : null}
      <nav className="capabilities-sidebar__categories" aria-label={t('capabilities.title.capabilities')}>
        {entries.map((entry) => {
          const Icon = entry.metadata.icon;
          const active = activeSectionId === entry.metadata.sectionId && !selectedPluginId;
          return (
            <Button
              variant="ghost"
              className="capabilities-sidebar__item"
              key={entry.key}
              aria-current={active ? 'page' : undefined}
              onClick={() => onOpenSection(entry.metadata.sectionId)}
            >
              {Icon ? <Icon size={16} /> : null}
              <span>{(t as (key: string) => string)(entry.metadata.titleKey)}</span>
            </Button>
          );
        })}
      </nav>
      <div className="capabilities-sidebar__installed">
        <RendererOwnedSingleSlot
          slot={capabilitiesSidebarSlot}
          props={{
            selectedPluginId,
            query,
            onSelectPlugin: (pluginId) => onOpenSection('plugins', pluginId),
            translate: t,
            ui: settingsViewUi,
          }}
        />
      </div>
    </aside>
  );
}
