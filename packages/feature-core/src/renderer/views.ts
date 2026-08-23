import type { ComponentType } from 'react';
import { defineCapability, type CapabilityToken } from '../capability.js';
import type { RuntimeCodec } from '../codec.js';
import type { FeatureId } from '../definition.js';
import type { FeatureScope } from '../scope.js';
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

export interface ComposerStatusViewRegistry {
  register(
    scope: FeatureScope,
    contribution: ComposerStatusViewContribution,
  ): Readonly<{ dispose(): void }>;
  list(): readonly RegisteredComposerStatusView[];
}

export const rendererComposerStatusViewRegistryCapability: CapabilityToken<ComposerStatusViewRegistry> = defineCapability({
  id: 'renderer.composer-status-views',
  major: 1,
  description: 'Owned and ordered status views rendered above the chat composer',
});

export type SettingsViewHostProps = Readonly<{
  sectionId: string;
  translate: RendererTranslate;
}>;

export type SettingsViewContribution = Readonly<{
  sectionId: string;
  location: SettingsViewLocation;
  order: number;
  titleKey: string;
  render: ComponentType<SettingsViewHostProps>;
}>;

export type RegisteredSettingsView = SettingsViewContribution & Readonly<{
  featureId: FeatureId;
}>;

export interface SettingsViewRegistry {
  register(scope: FeatureScope, contribution: SettingsViewContribution): Readonly<{ dispose(): void }>;
  list(location: SettingsViewLocation): readonly RegisteredSettingsView[];
  find(location: SettingsViewLocation, sectionId: string): RegisteredSettingsView | undefined;
}

export const rendererSettingsViewRegistryCapability: CapabilityToken<SettingsViewRegistry> = defineCapability({
  id: 'renderer.settings-views',
  major: 1,
  description: 'Owned and ordered renderer settings view contributions',
});

export type ToolResultViewProps<TPayload> = Readonly<{
  payload: TPayload;
  translate: RendererTranslate;
}>;

export type ToolResultViewContribution<TPayload> = Readonly<{
  id: string;
  resultKind: `${string}.${string}`;
  major: number;
  payload: RuntimeCodec<TPayload>;
  render: ComponentType<ToolResultViewProps<TPayload>>;
}>;

export type ErasedToolResultViewContribution = Readonly<{
  id: string;
  resultKind: `${string}.${string}`;
  major: number;
  payload: RuntimeCodec<unknown>;
  render: ComponentType<ToolResultViewProps<unknown>>;
}>;

export type ResolvedToolResultView = Readonly<{
  contribution: ErasedToolResultViewContribution;
  payload: unknown;
  featureId: FeatureId;
}>;

export interface ToolResultViewRegistry {
  register<TPayload>(
    scope: FeatureScope,
    contribution: ToolResultViewContribution<TPayload>,
  ): Readonly<{ dispose(): void }>;
  resolve(value: unknown): ResolvedToolResultView | null;
}

export const rendererToolResultViewRegistryCapability: CapabilityToken<ToolResultViewRegistry> = defineCapability({
  id: 'renderer.tool-result-views',
  major: 1,
  description: 'Exact resultKind and major renderer tool result views',
});
