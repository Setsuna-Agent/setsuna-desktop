import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const featuresRoot = path.join(repositoryRoot, 'packages/features');

if (existsSync(featuresRoot)) {
  const entries = await readdir(featuresRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePath = path.join(featuresRoot, entry.name, 'package.json');
    if (!existsSync(packagePath)) continue;
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
    if (typeof manifest.version !== 'string') {
      throw new Error(`${path.relative(repositoryRoot, packagePath)} is missing a package version.`);
    }
    const generatedDirectory = path.join(featuresRoot, entry.name, 'src/generated');
    await mkdir(generatedDirectory, { recursive: true });
    await writeFile(
      path.join(generatedDirectory, 'package-version.ts'),
      `export const FEATURE_PACKAGE_VERSION = ${JSON.stringify(manifest.version)} as const;\n`,
      'utf8',
    );
  }
}

console.log('Generated Feature package version constants.');
