import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'packages/app-sdk/dist');
await mkdir(destination, { recursive: true });
// Ship the same UI code, declarations and CSS. Independent app projects must not
// resolve workspace packages or files outside their managed project.
const shared = path.join(destination, 'renderer-ui');
await rm(shared, { recursive: true, force: true });
await mkdir(shared, { recursive: true });
const sharedRoot = path.join(root, 'packages/renderer-ui');
await cp(path.join(sharedRoot, 'dist'), path.join(shared, 'dist'), { recursive: true });
await cp(path.join(sharedRoot, 'src/styles'), path.join(shared, 'src/styles'), { recursive: true });
await copyFile(path.join(sharedRoot, 'package.json'), path.join(shared, 'package.json'));
const manifest = JSON.parse(await readFile(path.join(root, 'packages/app-sdk/package.json'), 'utf8'));
delete manifest.devDependencies;
delete manifest.scripts;
manifest.dependencies = { '@setsuna-desktop/renderer-ui': 'file:dist/renderer-ui' };
await writeFile(path.join(destination, 'package.json'), JSON.stringify(manifest, null, 2));
await copyFile(path.join(root, 'plugins/app-builder/skills/create-plugin-in-chat/assets/ui-base.css'), path.join(destination, 'ui-base.css'));
await copyFile(path.join(root, 'apps/desktop/renderer/src/shared/styles/tokens.css'), path.join(destination, 'tokens.css'));
// CSS copying alone misses utilities used by controls such as Tabs. Compile only
// the SDK and shared UI sources at packaging time, outside app startup/install.
const result = await build({
  configFile: false,
  root: path.join(root, 'packages/app-sdk'),
  plugins: [tailwindcss()],
  logLevel: 'warn',
  build: {
    write: false,
    rollupOptions: { input: path.join(root, 'packages/app-sdk/src/utility-styles.css') },
  },
});
const utilities = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output)
  .find(file => file.type === 'asset' && file.fileName.endsWith('.css'));
if (!utilities) throw new Error('The app SDK utility stylesheet was not compiled.');
await writeFile(path.join(destination, 'utilities.css'), utilities.source);
await writeFile(path.join(destination, 'styles.css'), `@import './tokens.css';
@import './utilities.css';
@import './ui-base.css';
@import './renderer-ui/src/styles/index.css';
body { color: var(--app-text); font-family: var(--app-font-family); font-size: var(--app-font-size); font-weight: var(--app-font-weight); }
`);
