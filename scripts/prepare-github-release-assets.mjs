import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { releaseTargets } from './release-assets.mjs';

const [downloadedArg, uploadArg] = process.argv.slice(2);
const downloadedDir = path.resolve(downloadedArg ?? 'release-artifacts/downloaded');
const uploadDir = path.resolve(uploadArg ?? 'release-artifacts/upload');

async function listFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(filePath));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

const installerNames = new Set(releaseTargets.map((target) => target.fileName));
const installers = new Map();
for (const filePath of await listFiles(downloadedDir)) {
  const fileName = path.basename(filePath);
  if (!installerNames.has(fileName)) continue;
  if (installers.has(fileName)) throw new Error(`Release asset name collision: ${fileName}`);
  installers.set(fileName, filePath);
}

// Validate the complete release before preparing anything for publication.
const missing = [...installerNames].filter((name) => !installers.has(name));
if (missing.length) throw new Error(`Missing release installers: ${missing.join(', ')}`);

await rm(uploadDir, { recursive: true, force: true });
await mkdir(uploadDir, { recursive: true });
const checksumLines = [];
for (const fileName of [...installerNames].sort()) {
  const filePath = installers.get(fileName);
  await copyFile(filePath, path.join(uploadDir, fileName));
  const checksum = createHash('sha256').update(await readFile(filePath)).digest('hex');
  checksumLines.push(`${checksum}  ${fileName}`);
}
await writeFile(path.join(uploadDir, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);

console.log(`Prepared ${installerNames.size} installers and SHA256SUMS in ${uploadDir}.`);
