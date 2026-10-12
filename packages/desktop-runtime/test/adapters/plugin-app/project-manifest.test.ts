import { describe, expect, it } from 'vitest';
import { appPackageManifest, validateAppProjectFiles } from '../../../src/adapters/plugin-app/project-manifest.js';

const app = { root: 'app', entry: 'Home.tsx', routes: [{ path: '/detail', entry: 'pages/Detail.tsx' }], actionIds: [] };
const files = new Map([['app/Home.tsx', 'export default () => null'], ['app/pages/Detail.tsx', 'export default () => null']]);

describe('managed app packages', () => {
  it('keeps registry dependencies and defaults while removing application-owned Node hooks', () => {
    const manifest = appPackageManifest(JSON.stringify({ dependencies: { zod: '^4.4.3', react: '18.3.1' },
      scripts: { postinstall: 'node hooks.mjs' }, pnpm: { patchedDependencies: { react: '../patch' } } }), 'notes');
    expect(manifest).toMatchObject({ name: 'notes', packageManager: 'pnpm@7.33.7',
      dependencies: { zod: '^4.4.3', react: '18.3.1', 'react-dom': '18.3.1', '@setsuna/app': 'file:.setsuna/sdk' } });
    expect(manifest).not.toHaveProperty('scripts');
    expect(manifest).not.toHaveProperty('pnpm');
    validateAppProjectFiles(app, files);
  });

  it('rejects missing routes, local/Git packages, package-manager hooks and lockfile escapes before installation', () => {
    expect(() => validateAppProjectFiles(app, new Map())).toThrow(/app\/Home.tsx.*app\/pages\/Detail.tsx/u);
    for (const version of ['file:../../host', 'git+https://example.com/repo', 'workspace:*', 'https://example.com/a.tgz']) {
      expect(() => appPackageManifest(JSON.stringify({ dependencies: { bad: version } }), 'notes')).toThrow('registry package');
    }
    for (const name of ['.npmrc', '.NPMRC', '.pnpmfile.cjs', 'pnpm-workspace.yaml', 'node_modules/a/index.js', '.setsuna/main.tsx']) {
      expect(() => validateAppProjectFiles(app, new Map([...files, [`app/${name}`, '']]))).toThrow('reserved');
    }
    for (const lockfile of ['dependencies: {evil: "file:/private"}', 'packages: {evil: {resolution: {directory: /private}}}',
      'packages: {evil: {resolution: {tarball: "https://example.com/../../secret"}}}']) {
      expect(() => validateAppProjectFiles(app, new Map([...files, ['app/pnpm-lock.yaml', lockfile]]))).toThrow();
    }
  });
});
