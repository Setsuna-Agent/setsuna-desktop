import { Button as UiButton, MenuSurface } from '@setsuna-desktop/renderer-ui';
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
import { AppRouteTopbarPortal } from '../../shared/ui/AppRouteTopbarPortal.js';
import { settingsViewUi } from '../../shared/ui/SettingsViewUi.js';
import { Button } from '../../shared/ui/primitives.js';
import { CapabilitiesSidebar } from './CapabilitiesSidebar.js';

export function CapabilitiesShell({
  activeProjectPath,
  onCreateInConversation,
  onUsePluginInConversation,
  onSelectedPluginIdChange,
  selectedPluginId,
}: Readonly<{
  activeProjectPath?: string;
  onCreateInConversation(skillId: string): void;
  onUsePluginInConversation(pluginId: string): void;
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
  const [sectionItemId, setSectionItemId] = useState<string | null>(null);
  const [catalogVisit, setCatalogVisit] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState(() => selectedPluginId ? 'plugins' : defaultSectionId);

  useEffect(() => {
    if (selectedPluginId) setActiveSectionId('plugins');
  }, [selectedPluginId]);

  useEffect(() => {
    if (!catalogEntries.some((entry) => entry.metadata.sectionId === activeSectionId)) {
      setActiveSectionId(defaultSectionId);
    }
  }, [activeSectionId, catalogEntries, defaultSectionId]);

  const openSection = useCallback((sectionId: string, itemId?: string) => {
    if (!catalogEntries.some((entry) => entry.metadata.sectionId === sectionId)) return;
    onSelectedPluginIdChange(sectionId === 'plugins' ? itemId ?? null : null);
    setSectionItemId(itemId ?? null);
    setActiveSectionId(sectionId);
    // 一级入口返回目录，同时清理各 Feature 自己持有的详情或编辑模式。
    if (!itemId) setCatalogVisit((visit) => visit + 1);
  }, [catalogEntries, onSelectedPluginIdChange]);
  const renderBreadcrumb = useCallback(({
    currentLabel,
    parentLabel,
    onBack,
  }: CapabilitiesBreadcrumbProps) => {
    const breadcrumb = (
      <nav className="desktop-capabilities-breadcrumb" aria-label={`${parentLabel} / ${currentLabel}`}>
        <UiButton variant="ghost" type="button" onClick={onBack}>{parentLabel}</UiButton>
        <ChevronRight aria-hidden="true" />
        <span title={currentLabel}>{currentLabel}</span>
      </nav>
    );
    return <AppRouteTopbarPortal>{breadcrumb}</AppRouteTopbarPortal>;
  }, []);
  const renderCreateMenu = useCallback((props: CapabilitiesCreateMenuProps) => (
    <CapabilitiesCreateMenu {...props} />
  ), []);
  const navigation = useMemo<CapabilitiesPageNavigation>(() => Object.freeze({
    activeItemId: activeSectionId === 'plugins' ? selectedPluginId : sectionItemId,
    catalogNavigation: null,
    catalogNavigationInPage: false,
    openChat: onCreateInConversation,
    openPluginChat: onUsePluginInConversation,
    renderBreadcrumb,
    renderCreateMenu,
    setActiveItemId: activeSectionId === 'plugins' ? onSelectedPluginIdChange : setSectionItemId,
    openSection,
    workspacePath: activeProjectPath ?? null,
  }), [
    activeProjectPath,
    activeSectionId,
    sectionItemId,
    openSection,
    onCreateInConversation,
    onUsePluginInConversation,
    onSelectedPluginIdChange,
    renderBreadcrumb,
    renderCreateMenu,
    selectedPluginId,
  ]);

  return (
    <>
      <CapabilitiesSidebar
        entries={catalogEntries}
        activeSectionId={activeSectionId}
        selectedPluginId={selectedPluginId}
        onOpenSection={openSection}
      />
      <RendererOwnedKeyedSlot
        key={`${activeSectionId}:${catalogVisit}`}
        entryKey={settingsPageKey('capabilities', activeSectionId)}
        slot={settingsPageSlot}
        props={{
          capabilities: navigation,
          sectionId: activeSectionId,
          translate: t,
          ui: settingsViewUi,
        }}
      />
    </>
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
        <MenuSurface className="desktop-capabilities-create-menu" role="menu" style={{ transformOrigin: 'top right' }}>
          {items.map((item) => (
            <UiButton variant="ghost"
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
            </UiButton>
          ))}
        </MenuSurface>
      ) : null}
    </div>
  );
}
