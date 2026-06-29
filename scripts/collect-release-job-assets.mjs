import { constants as fsConstants } from 'node:fs';
import { access, copyFile, cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const artifactId = process.argv[2];

if (!artifactId) {
  console.error('Usage: node scripts/collect-release-job-assets.mjs <artifact-id>');
  process.exit(1);
}

const releaseDir = path.resolve('release-artifacts');
const logsDir = path.resolve('release-logs');
const outputDir = path.resolve('release-upload', artifactId);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const artifactFilePatterns = [
  /\.appimage$/iu,
  /\.blockmap$/iu,
  /\.deb$/iu,
  /\.dmg$/iu,
  /\.exe$/iu,
  /\.msi$/iu,
  /\.rpm$/iu,
  /\.snap$/iu,
  /\.tar\.gz$/iu,
  /\.zip$/iu,
  /^latest.*\.ya?ml$/iu,
];

function isReleaseArtifact(fileName) {
  return artifactFilePatterns.some((pattern) => pattern.test(fileName));
}

const releaseEntries = await readdir(releaseDir, { withFileTypes: true }).catch(() => []);
const artifactFiles = releaseEntries
  .filter((entry) => entry.isFile() && isReleaseArtifact(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

if (!artifactFiles.length) {
  console.error(`No package artifacts were found in ${releaseDir}.`);
  process.exit(1);
}

for (const fileName of artifactFiles) {
  await copyFile(path.join(releaseDir, fileName), path.join(outputDir, fileName));
}

try {
  await access(logsDir, fsConstants.R_OK);
  await cp(logsDir, path.join(outputDir, 'logs'), { recursive: true });
} catch {
  // Logs are useful for release auditing, but artifact collection should still
  // fail only when package outputs are missing.
}

console.log(`Collected ${artifactFiles.length} release artifact(s) for ${artifactId}.`);
