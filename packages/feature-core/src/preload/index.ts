import type { FeatureDefinition, FeatureId } from '../definition.js';
import { FeatureCompositionValidationError } from '../status.js';

type BridgeKey<TBridge extends object> = Extract<keyof TBridge, string>;

export interface PreloadFeatureContributionWriter<TContribution extends object> {
  set<TKey extends BridgeKey<TContribution>>(key: TKey, value: TContribution[TKey]): void;
}

type ErasedPreloadFeatureContributionWriter = Readonly<{
  set(key: string, value: unknown): void;
}>;

export type PreloadFeatureModule = Readonly<{
  definition: FeatureDefinition;
  bridgeKeys: readonly string[];
  contribute(writer: ErasedPreloadFeatureContributionWriter): void;
}>;

export function definePreloadFeature<const TContribution extends object>(input: Readonly<{
  definition: FeatureDefinition;
  bridgeKeys: readonly BridgeKey<TContribution>[];
  contribute(writer: PreloadFeatureContributionWriter<TContribution>): void;
}>): PreloadFeatureModule {
  const bridgeKeys = Object.freeze([...input.bridgeKeys]);
  const declaredKeys = new Set<string>(bridgeKeys);
  if (declaredKeys.size !== bridgeKeys.length) {
    throw invalidPreloadBridge(
      `Preload Feature "${input.definition.id}" declares a bridge key more than once.`,
      [input.definition.id],
    );
  }

  return Object.freeze({
    definition: input.definition,
    bridgeKeys,
    contribute(writer: ErasedPreloadFeatureContributionWriter) {
      const contributedKeys = new Set<string>();
      const typedWriter: PreloadFeatureContributionWriter<TContribution> = Object.freeze({
        set<TKey extends BridgeKey<TContribution>>(key: TKey, value: TContribution[TKey]) {
          const bridgeKey = String(key);
          if (!declaredKeys.has(bridgeKey)) {
            throw invalidPreloadBridge(
              `Preload Feature "${input.definition.id}" contributed undeclared bridge key "${bridgeKey}".`,
              [input.definition.id],
            );
          }
          if (contributedKeys.has(bridgeKey)) {
            throw invalidPreloadBridge(
              `Preload Feature "${input.definition.id}" contributed bridge key "${bridgeKey}" more than once.`,
              [input.definition.id],
            );
          }
          contributedKeys.add(bridgeKey);
          writer.set(bridgeKey, value);
        },
      });
      input.contribute(typedWriter);

      const missingKeys = bridgeKeys.filter((key) => !contributedKeys.has(key));
      if (missingKeys.length) {
        throw invalidPreloadBridge(
          `Preload Feature "${input.definition.id}" did not contribute declared bridge key(s): ${missingKeys.join(', ')}.`,
          [input.definition.id],
        );
      }
    },
  });
}

interface PreloadBridgeBuilder<TBridge extends object> {
  addHost(contribution: Partial<TBridge>): void;
  addFeature(module: PreloadFeatureModule): void;
  build(): Readonly<TBridge>;
}

export interface PreloadFeatureHost<TBridge extends object> {
  compose(hostContribution: Partial<TBridge>): Readonly<TBridge>;
}

export function definePreloadFeatureHost<TBridge extends object>(input: Readonly<{
  bridgeKeys: readonly BridgeKey<TBridge>[];
  features: readonly PreloadFeatureModule[];
}>): PreloadFeatureHost<TBridge> {
  const bridgeKeys = Object.freeze([...input.bridgeKeys]);
  const features = Object.freeze([...input.features]);
  return Object.freeze({
    compose(hostContribution: Partial<TBridge>) {
      const builder = createPreloadBridgeBuilder<TBridge>(bridgeKeys);
      builder.addHost(hostContribution);
      for (const feature of features) builder.addFeature(feature);
      return builder.build();
    },
  });
}

/**
 * Assembles declared bridge subobjects only. It intentionally has no generic
 * IPC dispatch method: every callable surface still comes from a typed owner.
 */
function createPreloadBridgeBuilder<TBridge extends object>(
  requiredKeys: readonly BridgeKey<TBridge>[],
): PreloadBridgeBuilder<TBridge> {
  const contractKeys = new Set<string>(requiredKeys);
  if (contractKeys.size !== requiredKeys.length) {
    throw invalidPreloadBridge('Preload bridge contract contains a duplicate key.');
  }

  const values = new Map<string, unknown>();
  const owners = new Map<string, FeatureId | null>();
  const featureIds = new Set<FeatureId>();
  let built = false;

  const assertMutable = () => {
    if (built) throw new Error('Preload bridge has already been built.');
  };
  const add = (owner: FeatureId | null, key: string, value: unknown) => {
    assertMutable();
    if (!contractKeys.has(key)) {
      throw invalidPreloadBridge(
        `Preload bridge owner "${owner ?? 'host'}" contributed unknown key "${key}".`,
        owner ? [owner] : [],
      );
    }
    if (owners.has(key)) {
      const existingOwner = owners.get(key) ?? null;
      throw invalidPreloadBridge(
        `Preload bridge key "${key}" is contributed by both "${existingOwner ?? 'host'}" and "${owner ?? 'host'}".`,
        [existingOwner, owner].filter((featureId): featureId is FeatureId => featureId !== null),
      );
    }
    owners.set(key, owner);
    values.set(key, value);
  };

  return Object.freeze({
    addHost(contribution: Partial<TBridge>) {
      for (const [key, value] of Object.entries(contribution)) add(null, key, value);
    },
    addFeature(module: PreloadFeatureModule) {
      assertMutable();
      if (featureIds.has(module.definition.id)) {
        throw new FeatureCompositionValidationError([{
          code: 'DUPLICATE_FEATURE_ID',
          message: `Preload Feature "${module.definition.id}" is composed more than once.`,
          featureIds: [module.definition.id],
        }]);
      }
      featureIds.add(module.definition.id);
      for (const key of module.bridgeKeys) {
        if (!contractKeys.has(key)) {
          throw invalidPreloadBridge(
            `Preload Feature "${module.definition.id}" declares unknown bridge key "${key}".`,
            [module.definition.id],
          );
        }
      }
      module.contribute(Object.freeze({
        set: (key, value) => add(module.definition.id, key, value),
      }));
    },
    build(): Readonly<TBridge> {
      assertMutable();
      const missingKeys = requiredKeys.filter((key) => !values.has(key));
      if (missingKeys.length) {
        throw invalidPreloadBridge(`Preload bridge is missing required key(s): ${missingKeys.join(', ')}.`);
      }
      built = true;
      return Object.freeze(Object.fromEntries(values)) as Readonly<TBridge>;
    },
  });
}

function invalidPreloadBridge(
  message: string,
  featureIds: readonly FeatureId[] = [],
): FeatureCompositionValidationError {
  return new FeatureCompositionValidationError([{
    code: 'INVALID_PRELOAD_BRIDGE',
    message,
    ...(featureIds.length ? { featureIds: Object.freeze([...new Set(featureIds)]) } : {}),
  }]);
}

export type { FeatureDefinition, FeatureId } from '../definition.js';
