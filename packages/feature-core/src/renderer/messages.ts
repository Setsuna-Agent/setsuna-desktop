import type { FeatureId } from '../definition.js';
import {
  FeatureCompositionValidationError,
  type FeatureCompositionIssue,
} from '../status.js';

export type RendererMessageNamespace = `feature.${string}`;
export type RendererFeatureMessageKey = `feature.${string}`;
export type RendererTranslationParams = Readonly<Record<string, string | number>>;
export type RendererTranslate = (key: RendererFeatureMessageKey, params?: RendererTranslationParams) => string;

type NamespacedMessageMap<TNamespace extends RendererMessageNamespace> = Readonly<
  Record<`${TNamespace}.${string}`, string>
>;

export type RendererMessageBundle<
  TNamespace extends RendererMessageNamespace = RendererMessageNamespace,
  TLocale extends string = string,
> = Readonly<{
  namespace: TNamespace;
  fallbackLocale: TLocale;
  messages: Readonly<Partial<Record<TLocale, Readonly<Record<string, string>>>>>;
}>;

export type ComposedRendererMessages<TLocale extends string = string> = Readonly<{
  catalog: Readonly<Partial<Record<TLocale, Readonly<Record<string, string>>>>>;
  featureFallbackLocales: Readonly<Partial<Record<RendererMessageNamespace, TLocale>>>;
}>;

type RendererMessageModule = Readonly<{
  definition: Readonly<{ id: FeatureId }>;
  messages: readonly RendererMessageBundle[];
}>;

type RendererMessageMount = Readonly<{ module: RendererMessageModule }>;

export function defineRendererMessageBundle<
  const TNamespace extends RendererMessageNamespace,
  const TFallbackLocale extends string,
  const TMessages extends (
    Readonly<Record<TFallbackLocale, NamespacedMessageMap<TNamespace>>>
    & Readonly<Partial<Record<string, NamespacedMessageMap<TNamespace>>>>
  ),
>(input: Readonly<{
  namespace: TNamespace;
  fallbackLocale: TFallbackLocale;
  messages: TMessages;
}>): RendererMessageBundle<TNamespace> {
  validateRendererMessageBundle(input);
  const messages: Record<string, Readonly<Record<string, string>>> = {};
  for (const [locale, entries] of Object.entries(input.messages)) {
    messages[locale] = Object.freeze({ ...entries });
  }
  return Object.freeze({
    namespace: input.namespace,
    fallbackLocale: input.fallbackLocale,
    messages: Object.freeze(messages),
  });
}

/**
 * Merges static metadata from every installed module.
 * Call this before renderer setup so activation failures cannot remove recovery copy.
 */
export function composeRendererMessages<const TLocale extends string>(
  hostMessages: Readonly<Record<TLocale, Readonly<Record<string, string>>>>,
  mounts: readonly RendererMessageMount[],
): ComposedRendererMessages<TLocale> {
  const catalog = new Map<string, Map<string, string>>();
  const keyOwners = new Map<string, FeatureId | null>();
  const namespaceOwners = new Map<RendererMessageNamespace, FeatureId>();
  const featureFallbackLocales: Partial<Record<RendererMessageNamespace, TLocale>> = {};
  const issues: FeatureCompositionIssue[] = [];

  for (const [locale, entries] of Object.entries(hostMessages) as [TLocale, Readonly<Record<string, string>>][]) {
    const localeCatalog = new Map(Object.entries(entries));
    catalog.set(locale, localeCatalog);
    for (const key of localeCatalog.keys()) keyOwners.set(key, null);
  }

  for (const { module } of mounts) {
    for (const bundle of module.messages) {
      validateRendererMessageBundle(bundle);
      const existingOwner = namespaceOwners.get(bundle.namespace);
      if (existingOwner) {
        issues.push({
          code: 'DUPLICATE_RENDERER_MESSAGE_NAMESPACE',
          message: `Renderer message namespace "${bundle.namespace}" is owned by both "${existingOwner}" and "${module.definition.id}".`,
          featureIds: uniqueFeatureIds(existingOwner, module.definition.id),
        });
      } else {
        namespaceOwners.set(bundle.namespace, module.definition.id);
        featureFallbackLocales[bundle.namespace] = bundle.fallbackLocale as TLocale;
      }

      for (const [locale, entries] of Object.entries(bundle.messages)) {
        if (!entries) continue;
        let localeCatalog = catalog.get(locale);
        if (!localeCatalog) {
          localeCatalog = new Map();
          catalog.set(locale, localeCatalog);
        }
        for (const [key, value] of Object.entries(entries)) {
          if (keyOwners.has(key)) {
            const existingKeyOwner = keyOwners.get(key) ?? null;
            issues.push({
              code: 'DUPLICATE_RENDERER_MESSAGE_KEY',
              message: `Renderer message key "${key}" from "${module.definition.id}" conflicts with "${existingKeyOwner ?? 'host'}".`,
              featureIds: uniqueFeatureIds(existingKeyOwner, module.definition.id),
            });
            continue;
          }
          localeCatalog.set(key, value);
        }
      }
      for (const entries of Object.values(bundle.messages)) {
        if (!entries) continue;
        for (const key of Object.keys(entries)) {
          if (!keyOwners.has(key)) keyOwners.set(key, module.definition.id);
        }
      }
    }
  }

  if (issues.length) throw new FeatureCompositionValidationError(issues);

  return Object.freeze({
    catalog: Object.freeze(Object.fromEntries(
      [...catalog].map(([locale, entries]) => [locale, Object.freeze(Object.fromEntries(entries))]),
    )) as ComposedRendererMessages<TLocale>['catalog'],
    featureFallbackLocales: Object.freeze({ ...featureFallbackLocales }),
  });
}

function uniqueFeatureIds(
  ...featureIds: readonly (FeatureId | null)[]
): readonly FeatureId[] {
  return Object.freeze([...new Set(featureIds.filter((featureId): featureId is FeatureId => featureId !== null))]);
}

export function resolveRendererMessage(
  messages: ComposedRendererMessages,
  locale: string,
  hostFallbackLocale: string,
  key: string,
): string | undefined {
  const exact = messages.catalog[locale]?.[key];
  if (exact !== undefined) return exact;

  const baseLocale = locale.split('-')[0];
  if (baseLocale && baseLocale !== locale) {
    const base = messages.catalog[baseLocale]?.[key];
    if (base !== undefined) return base;
  }

  const featureNamespace = Object.keys(messages.featureFallbackLocales)
    .filter((namespace) => key.startsWith(`${namespace}.`))
    .sort((left, right) => right.length - left.length)[0] as RendererMessageNamespace | undefined;
  if (featureNamespace) {
    const fallbackLocale = messages.featureFallbackLocales[featureNamespace];
    return fallbackLocale ? messages.catalog[fallbackLocale]?.[key] : undefined;
  }

  return messages.catalog[hostFallbackLocale]?.[key];
}

function validateRendererMessageBundle(bundle: RendererMessageBundle): void {
  if (!/^feature\.[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(bundle.namespace)) {
    throw new Error(`Invalid Renderer message namespace "${bundle.namespace}".`);
  }
  const fallbackMessages = bundle.messages[bundle.fallbackLocale];
  if (!fallbackMessages) {
    throw new Error(
      `Renderer message namespace "${bundle.namespace}" has no messages for fallback locale "${bundle.fallbackLocale}".`,
    );
  }
  const fallbackKeys = new Set(Object.keys(fallbackMessages));
  for (const [locale, entries] of Object.entries(bundle.messages)) {
    if (!entries) continue;
    for (const [key, value] of Object.entries(entries)) {
      if (!key.startsWith(`${bundle.namespace}.`)) {
        throw new Error(`Renderer message key "${key}" is outside namespace "${bundle.namespace}".`);
      }
      if (typeof value !== 'string') throw new Error(`Renderer message "${key}" must be a string.`);
      if (locale !== bundle.fallbackLocale && !fallbackKeys.has(key)) {
        throw new Error(
          `Renderer message key "${key}" in locale "${locale}" is missing from fallback locale "${bundle.fallbackLocale}".`,
        );
      }
    }
  }
}
