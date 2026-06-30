import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();

async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function removeTsBuildInfoFiles(dir) {
  const entries = await listDir(dir);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tsbuildinfo'))
      .map((entry) => rm(path.join(dir, entry.name), { force: true })),
  );
}

async function listPackageDirs() {
  const packagesDir = path.join(rootDir, 'packages');
  const entries = await listDir(packagesDir);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name));
}

await rm(path.join(rootDir, 'dist'), { recursive: true, force: true });
await removeTsBuildInfoFiles(rootDir);

const packageDirs = await listPackageDirs();
await Promise.all(
  packageDirs.flatMap((packageDir) => [
    rm(path.join(packageDir, 'dist'), { recursive: true, force: true }),
    removeTsBuildInfoFiles(packageDir),
  ]),
);

console.log('Cleaned build outputs.');
