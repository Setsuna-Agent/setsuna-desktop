import {
  CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID,
  settingsPageKey,
  settingsPageSlot,
  type CapabilitiesBreadcrumbProps,
  type CapabilitiesCreateMenuProps,
  type CapabilitiesPageNavigation,
} from '@setsuna-desktop/renderer-contracts/settings';
import { ChevronRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RendererOwnedKeyedSlot,
  useRendererOwnedKeyedEntries,
} from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { getDesktopPlatform } from '../../shared/lib/desktopPlatform.js';
import { AppRouteTopbarPortal } from '../../shared/ui/AppRouteTopbarPortal.js';
import { settingsViewUi } from '../../shared/ui/SettingsViewUi.js';
import { Button } from '../../shared/ui/primitives.js';
import { shouldRenderCapabilitiesNavigationInPage } from './capabilitiesLayout.js';

export function CapabilitiesShell({
  activeProjectPath,
  onCreateInConversation,
  onSelectedPluginIdChange,
  selectedPluginId,
}: Readonly<{
  activeProjectPath?: string;
  onCreateInConversation(skillId: string): void;
  onSelectedPluginIdChange(pluginId: string | null): void;
  selectedPluginId: string | null;
}>) {
  const { t } = useI18n();
  const entries = useRendererOwnedKeyedEntries(settingsPageSlot);
  const catalogEntries = useMemo(() => entries
    .filter((entry) => (
      entry.metadata.location === 'capabilities'
      && entry.metadata.navigationGroupId === CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID
    ))
    .sort((left, right) => left.metadata.order - right.metadata.order || left.entryId.localeCompare(right.entryId)), [entries]);
  const defaultSectionId = catalogEntries[0]?.metadata.sectionId ?? 'plugins';
  const [activeSectionId, setActiveSectionId] = useState(() => selectedPluginId ? 'plugins' : defaultSectionId);

  useEffect(() => {
    if (selectedPluginId) setActiveSectionId('plugins');
  }, [selectedPluginId]);

  useEffect(() => {
    if (!catalogEntries.some((entry) => entry.metadata.sectionId === activeSectionId)) {
      setActiveSectionId(defaultSectionId);
    }
  }, [activeSectionId, catalogEntries, defaultSectionId]);

  const catalogNavigationInPage = shouldRenderCapabilitiesNavigationInPage(getDesktopPlatform());
  const tabs = useMemo(() => (
    <nav className="desktop-capabilities-tabs" aria-label={t('capabilities.title.capabilities')}>
      {catalogEntries.map((entry) => (
        <button
          className={activeSectionId === entry.metadata.sectionId ? 'is-active' : undefined}
          key={entry.key}
          type="button"
          onClick={() => {
            setActiveSectionId(entry.metadata.sectionId);
            if (entry.metadata.sectionId !== 'plugins') onSelectedPluginIdChange(null);
          }}
        >
          {(t as (key: string) => string)(entry.metadata.titleKey)}
        </button>
      ))}
    </nav>
  ), [activeSectionId, catalogEntries, onSelectedPluginIdChange, t]);
  const catalogNavigation = catalogNavigationInPage
    ? tabs
    : <AppRouteTopbarPortal>{tabs}</AppRouteTopbarPortal>;
  const renderBreadcrumb = useCallback(({
    currentLabel,
    parentLabel,
    onBack,
  }: CapabilitiesBreadcrumbProps) => {
    const breadcrumb = (
      <nav className="desktop-capabilities-breadcrumb" aria-label={`${parentLabel} / ${currentLabel}`}>
        <button type="button" onClick={onBack}>{parentLabel}</button>
        <ChevronRight aria-hidden="true" />
        <span title={currentLabel}>{currentLabel}</span>
      </nav>
    );
    return catalogNavigationInPage
      ? breadcrumb
      : <AppRouteTopbarPortal>{breadcrumb}</AppRouteTopbarPortal>;
  }, [catalogNavigationInPage]);
  const renderCreateMenu = useCallback((props: CapabilitiesCreateMenuProps) => (
    <CapabilitiesCreateMenu {...props} />
  ), []);
  const navigation = useMemo<CapabilitiesPageNavigation>(() => Object.freeze({
    activeItemId: selectedPluginId,
    catalogNavigation,
    catalogNavigationInPage,
    openChat: onCreateInConversation,
    renderBreadcrumb,
    renderCreateMenu,
    setActiveItemId: onSelectedPluginIdChange,
    workspacePath: activeProjectPath ?? null,
  }), [
    activeProjectPath,
    catalogNavigation,
    catalogNavigationInPage,
    onCreateInConversation,
    onSelectedPluginIdChange,
    renderBreadcrumb,
    renderCreateMenu,
    selectedPluginId,
  ]);

  return (
    <RendererOwnedKeyedSlot
      entryKey={settingsPageKey('capabilities', activeSectionId)}
      slot={settingsPageSlot}
      props={{
        capabilities: navigation,
        sectionId: activeSectionId,
        translate: t,
        ui: settingsViewUi,
      }}
    />
  );
}

function CapabilitiesCreateMenu({
  busy = false,
  buttonLabel,
  items,
  onOpenChange,
  open,
}: CapabilitiesCreateMenuProps) {
  return (
    <div className="desktop-capabilities-create">
      <Button
        aria-busy={busy || undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        icon={<Plus size={14} />}
        type="button"
        variant="primary"
        onClick={() => onOpenChange(!open)}
      >
        {buttonLabel}
      </Button>
      {open ? (
        <div className="desktop-capabilities-create-menu" role="menu">
          {items.map((item) => (
            <button
              className="desktop-capabilities-create-menu__item"
              disabled={item.disabled}
              key={item.id}
              role="menuitem"
              type="button"
              onClick={() => {
                onOpenChange(false);
                item.onSelect();
              }}
            >
              <span className="desktop-capabilities-create-menu__icon">{item.icon}</span>
              <span className="desktop-capabilities-create-menu__content">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
