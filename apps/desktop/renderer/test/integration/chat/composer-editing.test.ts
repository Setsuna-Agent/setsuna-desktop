import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(!['darwin', 'win32'].includes(process.platform))('keeps native paste/newline carets visible, preserves undo and references, and scrolls only the editor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-composer-editing-'));
  try {
    await build({ entryPoints: ['apps/desktop/renderer/test/fixtures/composer-editing.electron.ts'],
      outfile: path.join(root, 'main.cjs'), platform: 'node', format: 'cjs', bundle: true, external: ['electron'] });
    await build({ entryPoints: ['apps/desktop/renderer/test/fixtures/composer-editing.tsx'],
      outfile: path.join(root, 'renderer.js'), platform: 'browser', format: 'iife', bundle: true, jsx: 'automatic',
      tsconfig: 'tsconfig.renderer.json', loader: { '.css': 'empty', '.svg': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"development"' } });
    const styles = await Promise.all([
      'apps/desktop/renderer/src/shared/styles/tokens.css', 'apps/desktop/renderer/src/shared/styles/base.css',
      'apps/desktop/renderer/src/shared/styles/scrollbars.css', 'apps/desktop/renderer/src/features/chat/styles/chat-prompt.css',
    ].map((file) => readFile(file, 'utf8')));
    await writeFile(path.join(root, 'index.html'), `<!doctype html><html><head><style>${styles.join('\n')}
      #surrounding { height: 400px; overflow: auto; } .spacer { height: 500px; }
      </style></head><body><div id="surrounding"><div class="spacer"></div><div id="root"></div>
      <button id="other-focus">Other</button><div class="spacer"></div></div><script src="renderer.js"></script></body></html>`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electron as unknown as string, [path.join(root, 'main.cjs'), root], {
      env, windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024,
    });
    expect(stdout).toContain('COMPOSER_NATIVE_EDITING_OK');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
