const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const PACKAGE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

declare const featureIdBrand: unique symbol;
declare const packageVersionBrand: unique symbol;

export type FeatureId = string & { readonly [featureIdBrand]: true };
export type PackageVersion = string & { readonly [packageVersionBrand]: true };

export type FeatureDefinition = Readonly<{
  id: FeatureId;
  version: PackageVersion;
}>;

export function defineFeatureDefinition(input: Readonly<{ id: string; version: string }>): FeatureDefinition {
  if (!FEATURE_ID_PATTERN.test(input.id)) {
    throw new Error(`Invalid FeatureId "${input.id}". Expected lowercase kebab-case.`);
  }
  if (!PACKAGE_VERSION_PATTERN.test(input.version)) {
    throw new Error(`Invalid Feature package version "${input.version}".`);
  }
  return Object.freeze({
    id: input.id as FeatureId,
    version: input.version as PackageVersion,
  });
}
