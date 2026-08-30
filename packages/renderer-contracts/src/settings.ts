import { defineKeyedRendererSlot } from '@setsuna-desktop/feature-core/renderer';
import type {
  RendererTranslate,
  RendererKeyedEntryDescriptor,
  RendererUiRegistrar,
} from '@setsuna-desktop/feature-core/renderer';
import type { Disposer } from '@setsuna-desktop/feature-core/scope';
import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

export type SettingsViewLocation = 'capabilities' | 'settings';
export type SettingsPageKey = `${SettingsViewLocation}/${string}`;
export type SettingsPageExtensionKey = `${string}/${string}`;

export const CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID = 'catalog';

export type CapabilitiesBreadcrumbProps = Readonly<{
  currentLabel: string;
  parentLabel: string;
  onBack(): void;
}>;

export type CapabilitiesCreateMenuItem = Readonly<{
  description: string;
  disabled?: boolean;
  icon: ReactNode;
  id: string;
  onSelect(): void;
  title: string;
}>;

export type CapabilitiesCreateMenuProps = Readonly<{
  busy?: boolean;
  buttonLabel: string;
  items: readonly CapabilitiesCreateMenuItem[];
  onOpenChange(open: boolean): void;
  open: boolean;
}>;

export type CapabilitiesPageNavigation = Readonly<{
  /** Optional deep-link selected by another renderer surface, such as a plugin card in Chat. */
  activeItemId: string | null;
  /** Catalog-only navigation supplied by the host; detail and editor views omit it. */
  catalogNavigation: ReactNode;
  catalogNavigationInPage: boolean;
  workspacePath: string | null;
  openChat(skillId: string): void;
  renderBreadcrumb(props: CapabilitiesBreadcrumbProps): ReactNode;
  renderCreateMenu(props: CapabilitiesCreateMenuProps): ReactNode;
  setActiveItemId(itemId: string | null): void;
}>;

export type SettingsButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Readonly<{
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}>;

export type SettingsIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & Readonly<{
  children: ReactNode;
  label: string;
  variant?: 'secondary' | 'ghost' | 'danger';
}>;

export type SettingsTooltipProps = Readonly<{
  children: ReactElement;
  title: ReactNode;
}>;

export type SettingsToastProps = Readonly<{
  message: string;
  tone?: 'error' | 'info' | 'success' | 'warning';
}>;

export type SettingsSelectFieldProps = Readonly<{
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onValueChange(value: string): boolean | void;
  required?: boolean;
  title?: string;
  value: string;
  valueContent?: ReactNode;
}>;

export type SettingsSectionProps = Readonly<{
  children: ReactNode;
  className?: string;
  featureId?: string;
}>;

export type SettingsGroupProps = Readonly<{
  children: ReactNode;
  className?: string;
  title?: ReactNode;
}>;

export type SettingsRowProps = Readonly<{
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
}>;

export type SettingsToggleProps = Readonly<{
  checked: boolean;
  description: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onChange(checked: boolean): void;
}>;

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'checked' | 'children' | 'className' | 'onChange' | 'onClick' | 'type'
> & Readonly<{
  checked: boolean;
  children?: ReactNode;
  className?: string;
  indeterminate?: boolean;
  onChange(checked: boolean): void;
  onClick?: MouseEventHandler<HTMLLabelElement>;
}>;

export type SettingsNavigationRowProps = Readonly<{
  actionLabel: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onClick(): void;
}>;

export type SettingsDirectoryListProps = Readonly<{
  description: string;
  formatPresetCount?(count: number): string;
  inspectDirectories?(paths: readonly string[]): Promise<readonly Readonly<{
    count: number;
    path: string;
  }>[]>;
  label: string;
  onSave(items: string[]): Promise<unknown>;
  presetAddLabel?: string;
  presetRemoveLabel?: string;
  presets?: readonly Readonly<{
    homeRelativePath: readonly string[];
    id: string;
    label: string;
  }>[];
  value: readonly string[];
}>;

export type SettingsPageHeadingProps = Readonly<{
  action?: ReactNode;
  description?: string;
  title: string;
}>;

export type SettingsPageHeaderProps = Readonly<{
  actions?: ReactNode;
  className?: string;
  leading?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}>;

export type SettingsActionMenuItem = Readonly<{
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  id: string;
  label: ReactNode;
}>;

export type SettingsActionMenuProps = Readonly<{
  items: readonly SettingsActionMenuItem[];
  label: string;
  onSelect(id: string): void;
}>;

export type SettingsPageOutletProps = Readonly<{
  sectionId: string;
}>;

export type SettingsPluginIconProps = Readonly<{
  className?: string;
  name?: string;
  pluginId?: string;
  variant?: 'card' | 'detail' | 'inline' | 'installed' | 'list' | 'menu';
}>;

export type SettingsSkillIconProps = Readonly<{
  className?: string;
  skill?: Readonly<{
    icon?: string;
    kind: 'builtin' | 'plugin' | 'user';
    pluginId?: string;
  }>;
  variant?: 'inline' | 'list' | 'menu';
}>;

export type SettingsDialogProps = Readonly<{
  children: ReactNode;
  className?: string;
  closeLabel: string;
  footer?: ReactNode;
  onClose(): void;
  size?: 'small' | 'medium' | 'large';
  subtitle?: ReactNode;
  title: ReactNode;
  titleIcon?: ReactNode;
}>;

/** Host-owned controls keep Feature settings consistent and accessible. */
export type SettingsViewUi = Readonly<{
  ActionMenu: ComponentType<SettingsActionMenuProps>;
  Button: ComponentType<SettingsButtonProps>;
  Checkbox: ComponentType<CheckboxProps>;
  Dialog: ComponentType<SettingsDialogProps>;
  DirectoryList: ComponentType<SettingsDirectoryListProps>;
  EmptyState: ComponentType<Readonly<{ action?: ReactNode; body?: string; title: string }>>;
  Group: ComponentType<SettingsGroupProps>;
  IconButton: ComponentType<SettingsIconButtonProps>;
  NavigationRow: ComponentType<SettingsNavigationRowProps>;
  PageHeader: ComponentType<SettingsPageHeaderProps>;
  PageHeading: ComponentType<SettingsPageHeadingProps>;
  PageOutlet: ComponentType<SettingsPageOutletProps>;
  PluginIcon: ComponentType<SettingsPluginIconProps>;
  Row: ComponentType<SettingsRowProps>;
  Section: ComponentType<SettingsSectionProps>;
  SelectField: ComponentType<SettingsSelectFieldProps>;
  SkillIcon: ComponentType<SettingsSkillIconProps>;
  TextArea: ComponentType<TextareaHTMLAttributes<HTMLTextAreaElement>>;
  TextField: ComponentType<InputHTMLAttributes<HTMLInputElement>>;
  Toggle: ComponentType<SettingsToggleProps>;
  Toast: ComponentType<SettingsToastProps>;
  Tooltip: ComponentType<SettingsTooltipProps>;
}>;

export type SettingsPageSlotProps = Readonly<{
  capabilities?: CapabilitiesPageNavigation;
  /** Host implementation used by built-in settings page entries. */
  renderDefault?(): ReactNode;
  sectionId: string;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>;

export type SettingsViewIconProps = Readonly<{
  size?: string | number;
}>;

export type SettingsPageMetadata = Readonly<{
  descriptionKey?: string;
  icon?: ComponentType<SettingsViewIconProps>;
  layout?: 'default' | 'wide';
  location: SettingsViewLocation;
  navigationGroupId?: string;
  order: number;
  pageHeading?: 'host' | 'view';
  sectionId: string;
  titleKey: string;
}>;

export type SettingsPageExtensionMode =
  | Readonly<{ kind: 'section'; openSubpage(subpageId: string): void }>
  | Readonly<{ kind: 'subpage'; onBack(): void; subpageId: string }>;

export type SettingsPageExtensionSlotProps = SettingsPageSlotProps & Readonly<{
  mode: SettingsPageExtensionMode;
}>;

export type SettingsPageExtensionMetadata = Readonly<{
  id: string;
  order: number;
  subpageIds: readonly string[];
  targetSectionId: string;
}>;

export type SettingsPageEntryDescriptor = RendererKeyedEntryDescriptor<
  SettingsPageKey,
  SettingsPageMetadata
>;

export type SettingsPageExtensionEntryDescriptor = RendererKeyedEntryDescriptor<
  SettingsPageExtensionKey,
  SettingsPageExtensionMetadata
>;

export type SettingsPageRegistration = SettingsPageMetadata & Readonly<{
  entryId: string;
  priority?: number;
  render(props: SettingsPageSlotProps): ReactNode;
}>;

export type SettingsPageExtensionRegistration = Omit<
  SettingsPageExtensionMetadata,
  'subpageIds'
> & Readonly<{
  entryId: string;
  render(props: SettingsPageSlotProps & Readonly<{ openSubpage(subpageId: string): void }>): ReactNode;
  subpages?: readonly Readonly<{
    id: string;
    render(props: SettingsPageSlotProps & Readonly<{ onBack(): void }>): ReactNode;
  }>[];
}>;

export const settingsPageSlot = defineKeyedRendererSlot<
  SettingsPageKey,
  SettingsPageSlotProps,
  SettingsPageMetadata
>({
  id: 'renderer.settings.page',
  scope: 'app',
  userConfigurable: true,
});

export const settingsPageExtensionSlot = defineKeyedRendererSlot<
  SettingsPageExtensionKey,
  SettingsPageExtensionSlotProps,
  SettingsPageExtensionMetadata
>({
  id: 'renderer.settings.page.extensions',
  scope: 'app',
  userConfigurable: true,
});

export function settingsPageKey(location: SettingsViewLocation, sectionId: string): SettingsPageKey {
  return `${location}/${requiredIdentityPart(sectionId, 'settings section')}`;
}

export function settingsPageExtensionKey(
  targetSectionId: string,
  extensionId: string,
): SettingsPageExtensionKey {
  return `${requiredIdentityPart(targetSectionId, 'settings extension target')}/${
    requiredIdentityPart(extensionId, 'settings extension')}`;
}

export function registerSettingsPage(
  ui: RendererUiRegistrar,
  registration: SettingsPageRegistration,
): Disposer {
  const {
    entryId,
    priority,
    render,
    ...metadata
  } = registration;
  finiteOrder(metadata.order, `${entryId} settings page`);
  return ui.keyed(settingsPageSlot, {
    id: entryId,
    key: settingsPageKey(metadata.location, metadata.sectionId),
    metadata: Object.freeze({ ...metadata }),
    priority,
    render: (props) => render(props),
  });
}

export function registerSettingsPageExtension(
  ui: RendererUiRegistrar,
  registration: SettingsPageExtensionRegistration,
): Disposer {
  finiteOrder(registration.order, `${registration.entryId} settings extension`);
  const subpages = Object.freeze([...(registration.subpages ?? [])]);
  const subpageIds = new Set<string>();
  for (const subpage of subpages) {
    requiredIdentityPart(subpage.id, 'settings subpage');
    if (subpageIds.has(subpage.id)) {
      throw new Error(`Duplicate settings subpage: ${registration.entryId}/${subpage.id}`);
    }
    subpageIds.add(subpage.id);
  }
  const key = settingsPageExtensionKey(registration.targetSectionId, registration.id);
  return ui.keyed(settingsPageExtensionSlot, {
    id: registration.entryId,
    key,
    metadata: Object.freeze({
      id: registration.id,
      order: registration.order,
      subpageIds: Object.freeze([...subpageIds]),
      targetSectionId: registration.targetSectionId,
    }),
    render: (props) => {
      if (props.mode.kind === 'section') {
        return registration.render({
          sectionId: props.sectionId,
          translate: props.translate,
          ui: props.ui,
          openSubpage: props.mode.openSubpage,
        });
      }
      const mode = props.mode;
      const subpage = subpages.find((candidate) => candidate.id === mode.subpageId);
      return subpage?.render({
        sectionId: props.sectionId,
        translate: props.translate,
        ui: props.ui,
        onBack: mode.onBack,
      }) ?? null;
    },
  });
}

function requiredIdentityPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes('/')) {
    throw new Error(`Invalid ${label} id: ${value}`);
  }
  return normalized;
}

function finiteOrder(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} order must be finite.`);
}
