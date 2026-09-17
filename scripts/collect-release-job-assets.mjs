import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { releaseTargets } from './release-assets.mjs';

const artifactId = process.argv[2];
const target = releaseTargets.find((entry) => entry.jobArtifact === artifactId);
if (!target) throw new Error(`Unknown release artifact target: ${artifactId ?? '(missing)'}.`);

const releaseDir = path.resolve('release-artifacts');
const outputDir = path.resolve('release-upload', target.jobArtifact);
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
for (const fileName of target.fileNames) {
  await copyFile(path.join(releaseDir, fileName), path.join(outputDir, fileName));
}

console.log(`Collected ${target.fileNames.join(', ')}.`);
