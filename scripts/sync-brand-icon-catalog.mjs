import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageName = '@lobehub/icons-static-svg';
const packagePath = createRequire(import.meta.url).resolve(`${packageName}/package.json`);
const { version } = JSON.parse(await readFile(packagePath, 'utf8'));
const release = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${version}`);
if (release.version !== version || !/^[a-f0-9]{40}$/u.test(release.gitHead ?? '')) {
  throw new Error(`Missing source revision for ${packageName}@${version}.`);
}

// Use the installed release's commit so labels and aliases match the bundled SVGs.
const sourceUrl = `https://raw.githubusercontent.com/lobehub/lobe-icons/${release.gitHead}/src/toc.json`;
const entries = await fetchJson(sourceUrl);
const files = new Set(await readdir(path.join(path.dirname(packagePath), 'icons')));
const brands = entries.map(({ id, title, fullTitle }) => {
  if (typeof id !== 'string' || typeof title !== 'string' || typeof fullTitle !== 'string') {
    throw new Error('Invalid LobeHub brand metadata.');
  }
  const key = id.toLowerCase();
  if (!files.has(`${key}.svg`)) throw new Error(`Missing SVG for ${key}.`);
  return { key, label: title, searchText: fullTitle };
});
const keys = new Set(brands.map(({ key }) => key));
const primaryIcons = [...files].filter((name) => /^[a-z0-9]+\.svg$/u.test(name));
if (keys.size !== brands.length || primaryIcons.some((name) => !keys.has(name.slice(0, -4)))) {
  throw new Error('LobeHub metadata does not cover the installed icon catalog.');
}

const outputPath = path.join(rootDir, 'apps/desktop/renderer/src/shared/assets/provider-logos/lobehub-catalog.json');
const output = [
  '{',
  `  "sourceVersion": ${JSON.stringify(version)},`,
  `  "sourceUrl": ${JSON.stringify(sourceUrl)},`,
  '  "brands": [',
  brands.map((brand) => `    ${JSON.stringify(brand)}`).join(',\n'),
  '  ]',
  '}',
  '',
].join('\n');
await writeFile(outputPath, output);
console.log(`Synced ${brands.length} brands from ${packageName}@${version}.`);

async function fetchJson(url) {
  const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Failed to fetch brand metadata: HTTP ${response.status}`);
  return response.json();
}
