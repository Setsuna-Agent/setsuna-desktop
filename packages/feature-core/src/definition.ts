const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

declare const featureIdBrand: unique symbol;

export type FeatureId = string & { readonly [featureIdBrand]: true };

export type FeatureDefinition = Readonly<{
  id: FeatureId;
}>;

export function defineFeature(id: string): FeatureDefinition {
  if (!FEATURE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid FeatureId "${id}". Expected lowercase kebab-case.`);
  }
  return Object.freeze({
    id: id as FeatureId,
  });
}
