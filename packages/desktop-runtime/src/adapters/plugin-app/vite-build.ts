import type { RuntimeSandboxedUiSource } from '@setsuna-desktop/contracts';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

/** Managed config prevents loading application-owned Node hooks, Vite configs and env files. */
export async function buildAppProject(project: string): Promise<RuntimeSandboxedUiSource> {
  const { build } = await import('vite');
  const root = await realpath(project);
  const assertProjectFile = projectFileGuard(root);
  const result = await build({
    root, configFile: false, envFile: false, publicDir: false, logLevel: 'error',
    plugins: [{ name: 'setsuna-app-project-boundary', enforce: 'pre', async load(id) { await assertProjectFile(id); return null; } }],
    // Vite resolves CSS @import and url() outside Rollup's load hook. Its alias resolver
    // shares this guard so those reads cannot bypass the application project boundary.
    resolve: { alias: [{ find: /^(.+)$/u, replacement: '$1', customResolver: async function (source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      await assertProjectFile(resolved?.id ?? source);
      return resolved;
    } }] },
    esbuild: { jsx: 'automatic' }, css: { postcss: {} },
    // Cover computed access such as process.env["NODE_ENV"] in browser libraries.
    // Only a public build constant is exposed, never the compiler's environment.
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production' }) },
    build: {
      write: false, target: 'chrome130', cssCodeSplit: false, minify: 'esbuild',
      lib: { entry: path.join(root, '.setsuna/main.tsx'), name: 'SetsunaApp', formats: ['iife'] },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(result => 'output' in result ? result.output : []);
  const scripts = outputs.filter(output => output.type === 'chunk');
  const assets = outputs.filter(output => output.type === 'asset');
  if (scripts.length !== 1 || assets.some(asset => !asset.fileName.endsWith('.css'))) {
    throw new Error('This app emits standalone assets; inline imported assets for the document app runtime.');
  }
  const source = { html: '<div id="setsuna-app-root"></div>', js: scripts[0].code,
    css: assets.map(asset => typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source).toString()).join('\n') };
  if (Buffer.byteLength(JSON.stringify(source)) > 8 * 1024 * 1024) throw new Error('Compiled app exceeds the 8 MiB page limit.');
  return source;
}

function projectFileGuard(root: string): (id: string) => Promise<void> {
  const inside = (file: string) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
  return async id => {
    if (id.startsWith('\0')) return;
    const file = id.split('?')[0];
    if (path.isAbsolute(file) && !inside(await realpath(file).catch(() => file))) {
      throw new Error(`App imports must stay inside its project: ${id}`);
    }
    if (/\.(?:scss|sass|less|styl|stylus|sss)$/iu.test(file)) {
      throw new Error('Managed apps support plain CSS and CSS modules; Node-based CSS preprocessors are unavailable.');
    }
  };
}
