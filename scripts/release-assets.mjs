import packageJson from '../package.json' with { type: 'json' };

// Keep installers and native macOS update archives on the same allowlist.
// Internal build logs and unused builder metadata are never public downloads.
export const releaseTargets = [
  {
    jobArtifact: 'macos-arm64',
    platform: 'darwin',
    arch: 'arm64',
    label: 'macOS Apple Silicon',
    fileNames: [
      `Setsuna-Desktop-${packageJson.version}-mac-arm64.dmg`,
      `Setsuna-Desktop-${packageJson.version}-mac-arm64.zip`,
    ],
  },
  {
    jobArtifact: 'macos-x64',
    platform: 'darwin',
    arch: 'x64',
    label: 'macOS Intel',
    fileNames: [
      `Setsuna-Desktop-${packageJson.version}-mac-x64.dmg`,
      `Setsuna-Desktop-${packageJson.version}-mac-x64.zip`,
    ],
  },
  {
    jobArtifact: 'windows-x64',
    platform: 'win32',
    arch: 'x64',
    label: 'Windows x64',
    fileNames: [`Setsuna-Desktop-${packageJson.version}-windows-x64.exe`],
  },
];
