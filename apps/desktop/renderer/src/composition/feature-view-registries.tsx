import type {
  ComposerStatusViewContribution,
  ComposerStatusViewRegistry,
  ErasedToolResultViewContribution,
  RegisteredComposerStatusView,
  RegisteredSettingsView,
  ResolvedToolResultView,
  SettingsViewContribution,
  SettingsViewLocation,
  SettingsViewRegistry,
  ToolResultViewContribution,
  ToolResultViewRegistry,
} from '@setsuna-desktop/feature-core/renderer';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { createContext, useContext, type ReactNode } from 'react';
import { RendererFeatureEventHub } from './renderer-feature-event-hub.js';

const SECTION_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const RESULT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;

export class RendererComposerStatusViewRegistry implements ComposerStatusViewRegistry {
  private readonly contributions = new Map<string, RegisteredComposerStatusView>();

  register(
    scope: FeatureScope,
    contribution: ComposerStatusViewContribution,
  ): Readonly<{ dispose(): void }> {
    if (!RESULT_ID_PATTERN.test(contribution.id)) {
      throw new Error(`Invalid composer status contribution id: ${contribution.id}`);
    }
    if (!Number.isFinite(contribution.order)) throw new Error('Composer status view order must be finite.');
    if (this.contributions.has(contribution.id)) {
      throw new Error(`Composer status view conflict for ${contribution.id}.`);
    }
    const registered = Object.freeze({ ...contribution, featureId: scope.owner.featureId });
    this.contributions.set(contribution.id, registered);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (this.contributions.get(contribution.id) === registered) {
        this.contributions.delete(contribution.id);
      }
    };
    scope.add(dispose);
    return Object.freeze({ dispose });
  }

  list(): readonly RegisteredComposerStatusView[] {
    return Object.freeze([...this.contributions.values()]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)));
  }
}

export class RendererSettingsViewRegistry implements SettingsViewRegistry {
  private readonly contributions = new Map<string, RegisteredSettingsView>();

  register(scope: FeatureScope, contribution: SettingsViewContribution): Readonly<{ dispose(): void }> {
    if (!SECTION_ID_PATTERN.test(contribution.sectionId)) {
      throw new Error(`Invalid settings sectionId: ${contribution.sectionId}`);
    }
    if (!Number.isFinite(contribution.order)) throw new Error('Settings view order must be finite.');
    const key = settingsKey(contribution.location, contribution.sectionId);
    if (this.contributions.has(key)) throw new Error(`Settings view conflict for ${key}.`);
    const registered = Object.freeze({ ...contribution, featureId: scope.owner.featureId });
    this.contributions.set(key, registered);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (this.contributions.get(key) === registered) this.contributions.delete(key);
    };
    scope.add(dispose);
    return Object.freeze({ dispose });
  }

  list(location: SettingsViewLocation): readonly RegisteredSettingsView[] {
    return Object.freeze([...this.contributions.values()]
      .filter((contribution) => contribution.location === location)
      .sort((left, right) => left.order - right.order || left.sectionId.localeCompare(right.sectionId)));
  }

  find(location: SettingsViewLocation, sectionId: string): RegisteredSettingsView | undefined {
    return this.contributions.get(settingsKey(location, sectionId));
  }
}

export class RendererToolResultViewRegistry implements ToolResultViewRegistry {
  private readonly contributions = new Map<string, Readonly<{
    featureId: FeatureScope['owner']['featureId'];
    contribution: ErasedToolResultViewContribution;
  }>>();

  register<TPayload>(
    scope: FeatureScope,
    contribution: ToolResultViewContribution<TPayload>,
  ): Readonly<{ dispose(): void }> {
    if (!RESULT_ID_PATTERN.test(contribution.id) || !RESULT_ID_PATTERN.test(contribution.resultKind)) {
      throw new Error('Tool result contribution identifiers must be stable dotted identifiers.');
    }
    if (!Number.isSafeInteger(contribution.major) || contribution.major < 1) {
      throw new Error('Tool result contribution major must be a positive integer.');
    }
    const key = resultKey(contribution.resultKind, contribution.major);
    if (this.contributions.has(key)) throw new Error(`Tool result view conflict for ${key}.`);
    const legacy = contribution.legacy;
    const erased: ErasedToolResultViewContribution = Object.freeze({
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
    const registered = Object.freeze({ featureId: scope.owner.featureId, contribution: erased });
    this.contributions.set(key, registered);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (this.contributions.get(key) === registered) this.contributions.delete(key);
    };
    scope.add(dispose);
    return Object.freeze({ dispose });
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

function resolvedToolResult(
  registered: Readonly<{
    featureId: FeatureScope['owner']['featureId'];
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
  composerStatuses: RendererComposerStatusViewRegistry;
  events: RendererFeatureEventHub;
  settings: RendererSettingsViewRegistry;
  toolResults: RendererToolResultViewRegistry;
}>;

const EMPTY_FEATURE_VIEWS: RendererFeatureViews = Object.freeze({
  composerStatuses: new RendererComposerStatusViewRegistry(),
  events: new RendererFeatureEventHub(),
  settings: new RendererSettingsViewRegistry(),
  toolResults: new RendererToolResultViewRegistry(),
});

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

function resultKey(resultKind: string, major: number): string {
  return `${resultKind}\u0000${major}`;
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
