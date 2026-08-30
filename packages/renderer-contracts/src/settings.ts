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

export type SettingsPageHeadingProps = Readonly<{
  action?: ReactNode;
  description?: string;
  title: string;
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
  Button: ComponentType<SettingsButtonProps>;
  Checkbox: ComponentType<CheckboxProps>;
  Dialog: ComponentType<SettingsDialogProps>;
  EmptyState: ComponentType<Readonly<{ action?: ReactNode; body?: string; title: string }>>;
  Group: ComponentType<SettingsGroupProps>;
  IconButton: ComponentType<SettingsIconButtonProps>;
  NavigationRow: ComponentType<SettingsNavigationRowProps>;
  PageHeading: ComponentType<SettingsPageHeadingProps>;
  Row: ComponentType<SettingsRowProps>;
  Section: ComponentType<SettingsSectionProps>;
  SelectField: ComponentType<SettingsSelectFieldProps>;
  TextArea: ComponentType<TextareaHTMLAttributes<HTMLTextAreaElement>>;
  TextField: ComponentType<InputHTMLAttributes<HTMLInputElement>>;
  Toggle: ComponentType<SettingsToggleProps>;
  Toast: ComponentType<SettingsToastProps>;
  Tooltip: ComponentType<SettingsTooltipProps>;
}>;

export type SettingsPageSlotProps = Readonly<{
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
