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

const assetNames = new Set(releaseTargets.flatMap((target) => target.fileNames));
const assets = new Map();
for (const filePath of await listFiles(downloadedDir)) {
  const fileName = path.basename(filePath);
  if (!assetNames.has(fileName)) continue;
  if (assets.has(fileName)) throw new Error(`Release asset name collision: ${fileName}`);
  assets.set(fileName, filePath);
}

// Validate the complete release before preparing anything for publication.
const missing = [...assetNames].filter((name) => !assets.has(name));
if (missing.length) throw new Error(`Missing release assets: ${missing.join(', ')}`);

await rm(uploadDir, { recursive: true, force: true });
await mkdir(uploadDir, { recursive: true });
const checksumLines = [];
for (const fileName of [...assetNames].sort()) {
  const filePath = assets.get(fileName);
  await copyFile(filePath, path.join(uploadDir, fileName));
  const checksum = createHash('sha256').update(await readFile(filePath)).digest('hex');
  checksumLines.push(`${checksum}  ${fileName}`);
}
await writeFile(path.join(uploadDir, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);

console.log(`Prepared ${assetNames.size} assets and SHA256SUMS in ${uploadDir}.`);
