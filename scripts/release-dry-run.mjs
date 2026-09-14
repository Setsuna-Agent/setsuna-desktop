import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { releaseTargets } from './release-assets.mjs';

const outDir = path.resolve('release-artifacts/dry-run');
await mkdir(outDir, { recursive: true });

// This local planning file is not a public Release asset. Checksums are only
// generated from real installers by prepare-github-release-assets.mjs.
const manifest = {
  version: packageJson.version,
  platforms: releaseTargets,
  requiredAssets: [...releaseTargets.map((target) => target.fileName), 'SHA256SUMS'],
};
await writeFile(path.join(outDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote local release plan to ${outDir}.`);
