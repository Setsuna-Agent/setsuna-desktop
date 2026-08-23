import type { FeatureDefinition, FeatureId } from '../definition.js';

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
    throw new Error(`Preload Feature "${input.definition.id}" declares a bridge key more than once.`);
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
            throw new Error(
              `Preload Feature "${input.definition.id}" contributed undeclared bridge key "${bridgeKey}".`,
            );
          }
          if (contributedKeys.has(bridgeKey)) {
            throw new Error(
              `Preload Feature "${input.definition.id}" contributed bridge key "${bridgeKey}" more than once.`,
            );
          }
          contributedKeys.add(bridgeKey);
          writer.set(bridgeKey, value);
        },
      });
      input.contribute(typedWriter);

      const missingKeys = bridgeKeys.filter((key) => !contributedKeys.has(key));
      if (missingKeys.length) {
        throw new Error(
          `Preload Feature "${input.definition.id}" did not contribute declared bridge key(s): ${missingKeys.join(', ')}.`,
        );
      }
    },
  });
}

export interface PreloadBridgeBuilder<TBridge extends object> {
  addHost(contribution: Partial<TBridge>): void;
  addFeature(module: PreloadFeatureModule): void;
  build(): Readonly<TBridge>;
}

/**
 * Assembles declared bridge subobjects only. It intentionally has no generic
 * IPC dispatch method: every callable surface still comes from a typed owner.
 */
export function createPreloadBridgeBuilder<TBridge extends object>(
  requiredKeys: readonly BridgeKey<TBridge>[],
): PreloadBridgeBuilder<TBridge> {
  const contractKeys = new Set<string>(requiredKeys);
  if (contractKeys.size !== requiredKeys.length) {
    throw new Error('Preload bridge contract contains a duplicate key.');
  }

  const values = new Map<string, unknown>();
  const owners = new Map<string, string>();
  const featureIds = new Set<FeatureId>();
  let built = false;

  const assertMutable = () => {
    if (built) throw new Error('Preload bridge has already been built.');
  };
  const add = (owner: string, key: string, value: unknown) => {
    assertMutable();
    if (!contractKeys.has(key)) {
      throw new Error(`Preload bridge owner "${owner}" contributed unknown key "${key}".`);
    }
    const existingOwner = owners.get(key);
    if (existingOwner) {
      throw new Error(
        `Preload bridge key "${key}" is contributed by both "${existingOwner}" and "${owner}".`,
      );
    }
    owners.set(key, owner);
    values.set(key, value);
  };

  return Object.freeze({
    addHost(contribution: Partial<TBridge>) {
      for (const [key, value] of Object.entries(contribution)) add('host', key, value);
    },
    addFeature(module: PreloadFeatureModule) {
      assertMutable();
      if (featureIds.has(module.definition.id)) {
        throw new Error(`Preload Feature "${module.definition.id}" is composed more than once.`);
      }
      featureIds.add(module.definition.id);
      for (const key of module.bridgeKeys) {
        if (!contractKeys.has(key)) {
          throw new Error(
            `Preload Feature "${module.definition.id}" declares unknown bridge key "${key}".`,
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
        throw new Error(`Preload bridge is missing required key(s): ${missingKeys.join(', ')}.`);
      }
      built = true;
      return Object.freeze(Object.fromEntries(values)) as Readonly<TBridge>;
    },
  });
}

export type { FeatureDefinition, FeatureId } from '../definition.js';
