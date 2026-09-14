import packageJson from '../package.json' with { type: 'json' };

// Public downloads are installers only. Keep collection and release validation
// on the same list so build logs and builder metadata never become downloads.
export const releaseTargets = [
  {
    jobArtifact: 'macos-arm64',
    platform: 'darwin',
    arch: 'arm64',
    label: 'macOS Apple Silicon',
    fileName: `Setsuna-Desktop-${packageJson.version}-mac-arm64.dmg`,
  },
  {
    jobArtifact: 'macos-x64',
    platform: 'darwin',
    arch: 'x64',
    label: 'macOS Intel',
    fileName: `Setsuna-Desktop-${packageJson.version}-mac-x64.dmg`,
  },
  {
    jobArtifact: 'windows-x64',
    platform: 'win32',
    arch: 'x64',
    label: 'Windows x64',
    fileName: `Setsuna-Desktop-${packageJson.version}-windows-x64.exe`,
  },
];
