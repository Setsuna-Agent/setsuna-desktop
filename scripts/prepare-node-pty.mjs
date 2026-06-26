import { chmod, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

async function main() {
  let packageRoot;
  try {
    packageRoot = path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    return;
  }

  const prebuildRoot = path.join(packageRoot, 'prebuilds');
  let entries;
  try {
    entries = await readdir(prebuildRoot, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('darwin-'))
      .map(async (entry) => {
        const helperPath = path.join(prebuildRoot, entry.name, 'spawn-helper');
        try {
          await chmod(helperPath, 0o755);
        } catch {
          // Non-darwin installs and partial package caches do not always include this helper.
        }
      }),
  );
}

await main();
