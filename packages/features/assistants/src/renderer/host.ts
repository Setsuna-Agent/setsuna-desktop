import type { BrandIconConfig, RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { IconButtonProps } from '@setsuna-desktop/renderer-ui';
import type { ComponentType } from 'react';
import type { Assistant, AssistantModel } from '../contracts/index.js';

export type AssistantAvatarProps = Readonly<{
  assistant: Pick<Assistant, 'id' | 'avatar' | 'avatarColor'>;
  className?: string;
  size?: 'inline' | 'menu' | 'list';
}>;

export type AssistantAvatarValue = Readonly<{ avatar?: BrandIconConfig; avatarColor?: string }>;

export type AssistantAvatarFieldProps = Readonly<{
  value: AssistantAvatarValue;
  seed?: string;
  label: string;
  disabled?: boolean;
  onBusyChange(busy: boolean): void;
  onChange(value: AssistantAvatarValue): void;
}>;

export type AssistantModelPickerProps = Readonly<{
  models: readonly AssistantModel[];
  value?: RuntimeConfiguredModelReference;
  disabled?: boolean;
  translate: RendererTranslate;
  onChange(value: RuntimeConfiguredModelReference | undefined): void;
}>;

/** Desktop avatar and model controls; the feature cannot import the host's shared UI directly. */
export type AssistantsHostUi = Readonly<{
  Avatar: ComponentType<AssistantAvatarProps>;
  AvatarField: ComponentType<AssistantAvatarFieldProps>;
  ModelPicker: ComponentType<AssistantModelPickerProps>;
}>;

export type AssistantsToolbarProps = Readonly<{
  title: string;
  actions: readonly (IconButtonProps & { id: string })[];
}>;
