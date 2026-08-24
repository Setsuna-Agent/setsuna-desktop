import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Build and test tooling may discover sources; runtime inventory stays explicit in composition roots. */
export function createFeaturePackageSourceAliases(
  repositoryRoot: string,
): Readonly<Record<string, string>> {
  const featuresRoot = resolve(repositoryRoot, 'packages/features');
  return Object.freeze(Object.fromEntries(
    readdirSync(featuresRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => [
        `@setsuna-desktop/feature-${entry.name}`,
        resolve(featuresRoot, entry.name, 'src'),
      ]),
  ));
}
