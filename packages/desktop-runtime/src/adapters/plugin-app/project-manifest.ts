import type { RuntimePluginUiReactApp } from '@setsuna-desktop/contracts';
import { parse as parseYaml } from 'yaml';

export const DEFAULT_APP_DEPENDENCIES = Object.freeze({
  react: '18.3.1', 'react-dom': '18.3.1', 'react-router-dom': '7.18.4', 'lucide-react': '0.468.0',
});
const DEFAULT_APP_DEV_DEPENDENCIES = Object.freeze({ '@types/react': '^18.3.17', '@types/react-dom': '^18.3.5', typescript: '^5.7.2' });
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const REGISTRY_VERSION = /^[A-Za-z0-9.*+~^<>=| -]+$/u;

/** Registry packages only: local/Git dependencies and lifecycle hooks must not escape this project. */
export function appPackageManifest(source: string | undefined, name: string): Record<string, unknown> {
  const input = source === undefined ? {} : JSON.parse(source);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('App package.json must be an object.');
  const dependencies = packageDependencies(input.dependencies);
  const devDependencies = packageDependencies(input.devDependencies);
  return {
    name, version: typeof input.version === 'string' ? input.version : '0.0.0', private: true, type: 'module', packageManager: 'pnpm@7.33.7',
    dependencies: { ...DEFAULT_APP_DEPENDENCIES, ...dependencies, '@setsuna/app': 'file:.setsuna/sdk' },
    devDependencies: { ...DEFAULT_APP_DEV_DEPENDENCIES, ...devDependencies },
  };
}

export function validateAppProjectFiles(app: RuntimePluginUiReactApp, files: ReadonlyMap<string, string | Buffer>): void {
  const missing = [app.entry, ...(app.routes ?? []).map(route => route.entry)]
    .map(entry => `${app.root}/${entry}`).filter(entry => !files.has(entry));
  if (missing.length) throw new Error(`Missing React app entries: ${missing.join(', ')}`);
  const prefix = `${app.root}/`;
  for (const name of files.keys()) {
    if (!name.startsWith(prefix)) continue;
    const relative = name.slice(prefix.length);
    const parts = relative.toLowerCase().split('/');
    if (parts.some(part => part === 'node_modules' || part === '.setsuna' || part === '.npmrc'
      || part === '.pnpmfile.cjs' || part === 'pnpmfile.cjs' || part === 'pnpm-workspace.yaml')) {
      throw new Error(`React app source contains a reserved package-manager path: ${name}`);
    }
  }
  const packageSource = files.get(`${app.root}/package.json`);
  appPackageManifest(packageSource?.toString(), 'setsuna-app');
  const lockfile = files.get(`${app.root}/pnpm-lock.yaml`);
  if (lockfile) validateLockfile(parseYaml(lockfile.toString(), { maxAliasCount: 0 }));
}

function packageDependencies(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('App dependencies must be an object.');
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error('An app may declare at most 100 packages per dependency group.');
  return Object.fromEntries(entries.map(([name, version]) => {
    if (name === '@setsuna/app') return [name, 'file:.setsuna/sdk'];
    if (!PACKAGE_NAME.test(name) || typeof version !== 'string' || !version.trim() || version.length > 128 || !REGISTRY_VERSION.test(version)) {
      throw new Error(`App dependency must name a registry package and version: ${name}`);
    }
    return [name, version];
  }));
}

function validateLockfile(value: unknown): void {
  if (typeof value === 'string') {
    // Only the host-created SDK may be a local package. Other entries stay in the registry.
    if (/^(?:file:|link:|workspace:|git[+:]|https?:)/iu.test(value)
      && value !== 'file:.setsuna/sdk' && !value.startsWith('https:')) {
      throw new Error('App lockfile contains an unsupported external or local package source.');
    }
    if (value.includes('../') || value.includes('..\\')) throw new Error('App lockfile paths must remain inside the project.');
  } else if (Array.isArray(value)) for (const item of value) validateLockfile(item);
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('directory' in record && record.directory !== '.setsuna/sdk') throw new Error('App lockfile contains a local directory dependency.');
    for (const [key, item] of Object.entries(record)) { validateLockfile(key); validateLockfile(item); }
  }
}
