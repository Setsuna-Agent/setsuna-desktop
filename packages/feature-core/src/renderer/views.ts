import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import type { RuntimeCodec } from '../codec.js';
import type { FeatureId } from '../definition.js';
import type { RendererTranslate } from './messages.js';

export type SettingsViewLocation = 'settings' | 'capabilities';

export type ComposerActiveTurn = Readonly<{
  startedAt?: string;
  taskKind?: string;
}>;

export type ComposerStatusViewHostProps = Readonly<{
  activeTurn?: ComposerActiveTurn;
  threadId: string;
  translate: RendererTranslate;
}>;

export type ComposerStatusViewContribution = Readonly<{
  id: string;
  order: number;
  render: ComponentType<ComposerStatusViewHostProps>;
}>;

export type RegisteredComposerStatusView = ComposerStatusViewContribution & Readonly<{
  featureId: FeatureId;
}>;

export interface ComposerStatusViewCatalog {
  list(): readonly RegisteredComposerStatusView[];
}

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

/**
 * Host-owned controls for standard Feature settings. Features keep business
 * state and specialized presentation while the host keeps form behavior,
 * accessibility, density, and theme treatment consistent.
 */
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

export type SettingsViewHostProps = Readonly<{
  sectionId: string;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>;

export type SettingsViewIconProps = Readonly<{
  size?: string | number;
}>;

export type SettingsViewContribution = Readonly<{
  descriptionKey?: string;
  icon?: ComponentType<SettingsViewIconProps>;
  /** `wide` gives workspace-like settings enough room for split panes and data tables. */
  layout?: 'default' | 'wide';
  sectionId: string;
  location: SettingsViewLocation;
  /** Optional host navigation group; unknown or omitted groups fall back to Feature navigation. */
  navigationGroupId?: string;
  order: number;
  /** `view` lets a Feature place stateful actions beside the host-styled page title. */
  pageHeading?: 'host' | 'view';
  titleKey: string;
  render: ComponentType<SettingsViewHostProps>;
}>;

export type RegisteredSettingsView = SettingsViewContribution & Readonly<{
  featureId: FeatureId;
}>;

export type SettingsSectionExtensionHostProps = SettingsViewHostProps & Readonly<{
  openSubpage(subpageId: string): void;
}>;

export type SettingsSectionSubpageHostProps = SettingsViewHostProps & Readonly<{
  onBack(): void;
}>;

export type SettingsSectionSubpageContribution = Readonly<{
  id: string;
  render: ComponentType<SettingsSectionSubpageHostProps>;
}>;

/**
 * Appends Feature-owned settings to an existing host section without creating
 * another sidebar item. Optional subpages let the host own nested navigation
 * instead of leaving a Feature to simulate a page transition inside its slot.
 */
export type SettingsSectionExtensionContribution = Readonly<{
  id: string;
  targetSectionId: string;
  order: number;
  render: ComponentType<SettingsSectionExtensionHostProps>;
  subpages?: readonly SettingsSectionSubpageContribution[];
}>;

export type RegisteredSettingsSectionExtension = SettingsSectionExtensionContribution & Readonly<{
  featureId: FeatureId;
}>;

export interface SettingsViewCatalog {
  list(location: SettingsViewLocation): readonly RegisteredSettingsView[];
  listSectionExtensions(targetSectionId: string): readonly RegisteredSettingsSectionExtension[];
  find(location: SettingsViewLocation, sectionId: string): RegisteredSettingsView | undefined;
}

export type ToolResultViewProps<TPayload> = Readonly<{
  payload: TPayload;
  /** Thread whose transcript currently owns this persisted tool result. */
  threadId: string | null;
  translate: RendererTranslate;
}>;

export type ToolResultViewContribution<TPayload> = Readonly<{
  id: string;
  resultKind: `${string}.${string}`;
  major: number;
  payload: RuntimeCodec<TPayload>;
  /** Limit decoding to persisted runs produced by these runtime tools. */
  sourceToolNames?: readonly string[];
  /** Identifies and decodes a result persisted before Feature envelopes existed. */
  legacy?: Readonly<{
    matches(value: unknown): boolean;
    payload: RuntimeCodec<TPayload>;
  }>;
  /** Stable identity used to keep only the latest equivalent persistent result. */
  identity?: (payload: TPayload) => string | null;
  /** `replace` lets the contribution own the complete tool-result surface. */
  presentation?: 'details' | 'replace';
  /** Render after the completed assistant response instead of inside tool history. */
  placement?: 'inline' | 'assistant-tail';
  /** Keep this result visible when surrounding work history is collapsed. */
  workHistoryPresentation?: 'persistent';
  render: ComponentType<ToolResultViewProps<TPayload>>;
}>;

export type ErasedToolResultViewContribution = Readonly<{
  id: string;
  resultKind: `${string}.${string}`;
  major: number;
  payload: RuntimeCodec<unknown>;
  /** Limit decoding to persisted runs produced by these runtime tools. */
  sourceToolNames?: readonly string[];
  /** Identifies and decodes a result persisted before Feature envelopes existed. */
  legacy?: Readonly<{
    matches(value: unknown): boolean;
    payload: RuntimeCodec<unknown>;
  }>;
  /** Stable identity used to keep only the latest equivalent persistent result. */
  identity?: (payload: unknown) => string | null;
  /** `replace` lets the contribution own the complete tool-result surface. */
  presentation?: 'details' | 'replace';
  /** Render after the completed assistant response instead of inside tool history. */
  placement?: 'inline' | 'assistant-tail';
  /** Keep this result visible when surrounding work history is collapsed. */
  workHistoryPresentation?: 'persistent';
  render: ComponentType<ToolResultViewProps<unknown>>;
}>;

export type ResolvedToolResultView = Readonly<{
  contribution: ErasedToolResultViewContribution;
  payload: unknown;
  featureId: FeatureId;
}>;

export interface ToolResultViewCatalog {
  resolve(
    value: unknown,
    context?: Readonly<{ toolName: string }>,
  ): ResolvedToolResultView | null;
}

export type RendererFeatureContributionInput = Readonly<{
  composerStatusViews?: readonly ComposerStatusViewContribution[];
  settingsViews?: readonly SettingsViewContribution[];
  settingsSectionExtensions?: readonly SettingsSectionExtensionContribution[];
  toolResultViews?: readonly ToolResultViewContribution<any>[];
}>;

export type RendererFeatureContributions = Readonly<{
  composerStatusViews: readonly ComposerStatusViewContribution[];
  settingsViews: readonly SettingsViewContribution[];
  settingsSectionExtensions: readonly SettingsSectionExtensionContribution[];
  toolResultViews: readonly ToolResultViewContribution<any>[];
}>;
