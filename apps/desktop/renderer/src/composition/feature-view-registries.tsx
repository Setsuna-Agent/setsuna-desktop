import type {
  ComposerStatusViewCatalog,
  ErasedToolResultViewContribution,
  RegisteredComposerStatusView,
  RegisteredSettingsSectionExtension,
  RegisteredSettingsView,
  RendererFeatureActivation,
  ResolvedToolResultView,
  SettingsViewCatalog,
  SettingsViewLocation,
  ToolResultViewCatalog,
  ToolResultViewContribution,
} from '@setsuna-desktop/feature-core/renderer';
import { FeatureCompositionValidationError } from '@setsuna-desktop/feature-core/status';
import { createContext, useContext, type ReactNode } from 'react';
import { RendererFeatureEventHub } from './renderer-feature-event-hub.js';

const SECTION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const HOST_SECTION_ID_PATTERN = /^[a-z][A-Za-z0-9]*(?:-[a-z0-9]+)*$/u;
const RESULT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;

/** Immutable view catalogs assembled once from successfully activated modules. */
export class RendererComposerStatusViewCatalog implements ComposerStatusViewCatalog {
  private readonly contributions = new Map<string, RegisteredComposerStatusView>();

  constructor(activations: readonly RendererFeatureActivation[] = []) {
    for (const { featureId, value } of activations) {
      for (const contribution of value.composerStatusViews) {
        if (!RESULT_ID_PATTERN.test(contribution.id)) {
          throw invalidContributionError(`Invalid composer status contribution id: ${contribution.id}`, featureId);
        }
        if (!Number.isFinite(contribution.order)) {
          throw invalidContributionError('Composer status view order must be finite.', featureId);
        }
        const existing = this.contributions.get(contribution.id);
        if (existing) {
          throw duplicateContributionError(
            `composer status view "${contribution.id}"`,
            existing.featureId,
            featureId,
          );
        }
        this.contributions.set(contribution.id, Object.freeze({ ...contribution, featureId }));
      }
    }
  }

  list(): readonly RegisteredComposerStatusView[] {
    return Object.freeze([...this.contributions.values()]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)));
  }
}

export class RendererSettingsViewCatalog implements SettingsViewCatalog {
  private readonly contributions = new Map<string, RegisteredSettingsView>();
  private readonly sectionExtensions = new Map<string, RegisteredSettingsSectionExtension>();

  constructor(activations: readonly RendererFeatureActivation[] = []) {
    for (const { featureId, value } of activations) {
      for (const contribution of value.settingsViews) {
        if (!SECTION_ID_PATTERN.test(contribution.sectionId)) {
          throw invalidContributionError(`Invalid settings sectionId: ${contribution.sectionId}`, featureId);
        }
        if (!Number.isFinite(contribution.order)) {
          throw invalidContributionError('Settings view order must be finite.', featureId);
        }
        const key = settingsKey(contribution.location, contribution.sectionId);
        const existing = this.contributions.get(key);
        if (existing) {
          throw duplicateContributionError(
            `settings view "${contribution.location}/${contribution.sectionId}"`,
            existing.featureId,
            featureId,
          );
        }
        this.contributions.set(key, Object.freeze({ ...contribution, featureId }));
      }

      for (const contribution of value.settingsSectionExtensions) {
        if (!SECTION_ID_PATTERN.test(contribution.id)) {
          throw invalidContributionError(`Invalid settings section extension id: ${contribution.id}`, featureId);
        }
        if (!HOST_SECTION_ID_PATTERN.test(contribution.targetSectionId)) {
          throw invalidContributionError(
            `Invalid settings extension targetSectionId: ${contribution.targetSectionId}`,
            featureId,
          );
        }
        if (!Number.isFinite(contribution.order)) {
          throw invalidContributionError('Settings section extension order must be finite.', featureId);
        }
        const subpageIds = new Set<string>();
        const subpages = Object.freeze((contribution.subpages ?? []).map((subpage) => {
          if (!SECTION_ID_PATTERN.test(subpage.id)) {
            throw invalidContributionError(`Invalid settings section subpage id: ${subpage.id}`, featureId);
          }
          if (subpageIds.has(subpage.id)) {
            throw invalidContributionError(
              `Settings section subpage conflict for ${contribution.id}:${subpage.id}.`,
              featureId,
            );
          }
          subpageIds.add(subpage.id);
          return Object.freeze({ ...subpage });
        }));
        const key = settingsSectionExtensionKey(contribution.targetSectionId, contribution.id);
        const existing = this.sectionExtensions.get(key);
        if (existing) {
          throw duplicateContributionError(
            `settings section extension "${contribution.targetSectionId}/${contribution.id}"`,
            existing.featureId,
            featureId,
          );
        }
        this.sectionExtensions.set(key, Object.freeze({
          ...contribution,
          featureId,
          subpages,
        }));
      }
    }
  }

  list(location: SettingsViewLocation): readonly RegisteredSettingsView[] {
    return Object.freeze([...this.contributions.values()]
      .filter((contribution) => contribution.location === location)
      .sort((left, right) => left.order - right.order || left.sectionId.localeCompare(right.sectionId)));
  }

  listSectionExtensions(targetSectionId: string): readonly RegisteredSettingsSectionExtension[] {
    return Object.freeze([...this.sectionExtensions.values()]
      .filter((contribution) => contribution.targetSectionId === targetSectionId)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)));
  }

  find(location: SettingsViewLocation, sectionId: string): RegisteredSettingsView | undefined {
    return this.contributions.get(settingsKey(location, sectionId));
  }
}

export class RendererToolResultViewCatalog implements ToolResultViewCatalog {
  private readonly contributions = new Map<string, Readonly<{
    featureId: RendererFeatureActivation['featureId'];
    contribution: ErasedToolResultViewContribution;
  }>>();

  constructor(activations: readonly RendererFeatureActivation[] = []) {
    for (const { featureId, value } of activations) {
      for (const contribution of value.toolResultViews) {
        if (!RESULT_ID_PATTERN.test(contribution.id) || !RESULT_ID_PATTERN.test(contribution.resultKind)) {
          throw invalidContributionError(
            'Tool result contribution identifiers must be stable dotted identifiers.',
            featureId,
          );
        }
        if (!Number.isSafeInteger(contribution.major) || contribution.major < 1) {
          throw invalidContributionError('Tool result contribution major must be a positive integer.', featureId);
        }
        const key = resultKey(contribution.resultKind, contribution.major);
        const existing = this.contributions.get(key);
        if (existing) {
          throw duplicateContributionError(
            `tool result view "${contribution.resultKind}@${contribution.major}"`,
            existing.featureId,
            featureId,
          );
        }
        this.contributions.set(key, Object.freeze({
          featureId,
          contribution: eraseToolResultContribution(contribution),
        }));
      }
    }
  }

  resolve(value: unknown): ResolvedToolResultView | null {
    const envelope = toolResultEnvelope(value);
    if (envelope) {
      const registered = this.contributions.get(resultKey(envelope.resultKind, envelope.resultMajor));
      if (!registered) return null;
      try {
        return resolvedToolResult(registered, registered.contribution.payload.parse(envelope.payload));
      } catch {
        console.warn(`[feature-tool-result] Invalid payload for ${envelope.resultKind}@${envelope.resultMajor}.`);
        return null;
      }
    }
    for (const registered of this.contributions.values()) {
      const legacy = registered.contribution.legacy;
      if (!legacy || !legacy.matches(value)) continue;
      try {
        return resolvedToolResult(registered, legacy.payload.parse(value));
      } catch {
        console.warn(`[feature-tool-result] Invalid legacy payload for ${registered.contribution.id}.`);
        return null;
      }
    }
    return null;
  }
}

function eraseToolResultContribution<TPayload>(
  contribution: ToolResultViewContribution<TPayload>,
): ErasedToolResultViewContribution {
  const legacy = contribution.legacy;
  return Object.freeze({
    ...contribution,
    payload: Object.freeze({ parse: (value: unknown) => contribution.payload.parse(value) as unknown }),
    ...(legacy
      ? {
          legacy: Object.freeze({
            matches: legacy.matches,
            payload: Object.freeze({
              parse: (value: unknown) => legacy.payload.parse(value) as unknown,
            }),
          }),
        }
      : {}),
    render: contribution.render as ErasedToolResultViewContribution['render'],
  });
}

function resolvedToolResult(
  registered: Readonly<{
    featureId: RendererFeatureActivation['featureId'];
    contribution: ErasedToolResultViewContribution;
  }>,
  payload: unknown,
): ResolvedToolResultView {
  return Object.freeze({
    featureId: registered.featureId,
    contribution: registered.contribution,
    payload,
  });
}

export type RendererFeatureViews = Readonly<{
  composerStatuses: RendererComposerStatusViewCatalog;
  events: RendererFeatureEventHub;
  settings: RendererSettingsViewCatalog;
  toolResults: RendererToolResultViewCatalog;
}>;

export function createRendererFeatureViews(
  activations: readonly RendererFeatureActivation[],
  events = new RendererFeatureEventHub(),
): RendererFeatureViews {
  return Object.freeze({
    composerStatuses: new RendererComposerStatusViewCatalog(activations),
    events,
    settings: new RendererSettingsViewCatalog(activations),
    toolResults: new RendererToolResultViewCatalog(activations),
  });
}

const EMPTY_FEATURE_VIEWS = createRendererFeatureViews([]);
const FeatureViewsContext = createContext<RendererFeatureViews>(EMPTY_FEATURE_VIEWS);

export function RendererFeatureViewsProvider({
  children,
  views,
}: Readonly<{ children: ReactNode; views: RendererFeatureViews }>) {
  return <FeatureViewsContext.Provider value={views}>{children}</FeatureViewsContext.Provider>;
}

export function useRendererFeatureViews(): RendererFeatureViews {
  return useContext(FeatureViewsContext);
}

function settingsKey(location: SettingsViewLocation, sectionId: string): string {
  return `${location}\u0000${sectionId}`;
}

function settingsSectionExtensionKey(targetSectionId: string, id: string): string {
  return `${targetSectionId}\u0000${id}`;
}

function resultKey(resultKind: string, major: number): string {
  return `${resultKind}\u0000${major}`;
}

function duplicateContributionError(
  contribution: string,
  firstFeatureId: RendererFeatureActivation['featureId'],
  secondFeatureId: RendererFeatureActivation['featureId'],
): FeatureCompositionValidationError {
  return new FeatureCompositionValidationError([{
    code: 'DUPLICATE_RENDERER_CONTRIBUTION',
    message: `Renderer ${contribution} is contributed by both "${firstFeatureId}" and "${secondFeatureId}".`,
    featureIds: Object.freeze([...new Set([firstFeatureId, secondFeatureId])]),
  }]);
}

function invalidContributionError(
  message: string,
  featureId: RendererFeatureActivation['featureId'],
): FeatureCompositionValidationError {
  return new FeatureCompositionValidationError([{
    code: 'INVALID_RENDERER_CONTRIBUTION',
    message,
    featureIds: [featureId],
  }]);
}

function toolResultEnvelope(value: unknown): Readonly<{
  resultKind: `${string}.${string}`;
  resultMajor: number;
  payload: unknown;
}> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.resultKind !== 'string'
    || !RESULT_ID_PATTERN.test(record.resultKind)
    || !Number.isSafeInteger(record.resultMajor)
    || (record.resultMajor as number) < 1
    || !('payload' in record)
  ) return null;
  return {
    resultKind: record.resultKind as `${string}.${string}`,
    resultMajor: record.resultMajor as number,
    payload: record.payload,
  };
}
