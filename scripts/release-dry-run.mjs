import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };

const outDir = path.resolve('release-artifacts/dry-run');
await mkdir(outDir, { recursive: true });

const manifest = {
  version: packageJson.version,
  commit: process.env.GITHUB_SHA ?? 'local',
  builtAt: new Date().toISOString(),
  canonicalSource: 'github-release',
  platforms: [
    {
      platform: 'darwin',
      arch: 'arm64',
      label: 'macOS Apple Silicon',
      artifacts: ['Setsuna-Desktop-*-mac-arm64.dmg', 'Setsuna-Desktop-*-mac-arm64.zip'],
      signing: 'unsigned',
      notarization: 'skipped',
      installMode: 'manual',
    },
    {
      platform: 'darwin',
      arch: 'x64',
      label: 'macOS Intel',
      artifacts: ['Setsuna-Desktop-*-mac-x64.dmg', 'Setsuna-Desktop-*-mac-x64.zip'],
      signing: 'unsigned',
      notarization: 'skipped',
      installMode: 'manual',
    },
    {
      platform: 'win32',
      arch: 'x64',
      label: 'Windows x64',
      artifacts: ['Setsuna-Desktop-*-windows-x64.exe', 'Setsuna-Desktop-*-windows-x64.zip'],
      signing: 'unsigned',
      notarization: 'not-applicable',
      installMode: 'installer-or-portable',
    },
    {
      platform: 'linux',
      arch: 'x64',
      label: 'Ubuntu x64',
      artifacts: ['Setsuna-Desktop-*-ubuntu-x64.AppImage', 'Setsuna-Desktop-*-ubuntu-x64.deb', 'Setsuna-Desktop-*-ubuntu-x64.tar.gz'],
      signing: 'unsigned',
      notarization: 'not-applicable',
      installMode: 'package-or-appimage',
    },
  ],
  requiredAssets: [
    'installers-or-archives',
    'SHA256SUMS',
    'release-manifest.json',
    `build-logs-v${packageJson.version}.zip`,
    'updater-metadata',
    'license-notices-or-sbom',
  ],
};

const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(path.join(outDir, 'release-manifest.json'), manifestText);
await writeFile(
  path.join(outDir, 'SHA256SUMS'),
  `${createHash('sha256').update(manifestText).digest('hex')}  release-manifest.json\n`,
);

console.log(`Wrote dry-run release metadata to ${outDir}`);
