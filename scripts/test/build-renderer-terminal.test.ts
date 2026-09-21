import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

it('keeps terminal mode queries and subsequent input working in the production bundle', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-build-'));
  const entryId = 'setsuna-terminal-build-probe';
  try {
    // Use the real renderer build pipeline: importing xterm directly in Vitest
    // bypasses the production optimization that broke Vim's DECRQM handshake.
    const result = await build({
      configFile: path.resolve('vite.config.ts'),
      logLevel: 'silent',
      plugins: [{
        name: 'terminal-build-probe',
        resolveId: (id) => id === entryId ? `\0${entryId}` : undefined,
        load: (id) => id === `\0${entryId}` ? [
          "export { Terminal } from '@xterm/xterm';",
          "export { FitAddon } from '@xterm/addon-fit';",
          "import '@xterm/xterm/css/xterm.css';",
        ].join('\n') : undefined,
      }],
      build: {
        outDir,
        emptyOutDir: false,
        rollupOptions: { input: entryId, preserveEntrySignatures: 'strict' },
      },
    });
    if ('on' in result || Array.isArray(result)) throw new Error('Expected one renderer build.');
    const entry = result.output.find((item) => item.type === 'chunk' && item.isEntry);
    if (!entry) throw new Error('Missing terminal build entry.');
    await writeFile(path.join(outDir, 'package.json'), '{"type":"module"}');

    // Run the emitted JS in a separate process so an asynchronous parser crash
    // fails this test directly instead of becoming an unhandled Vitest error.
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
      import { Terminal, FitAddon } from ${JSON.stringify(pathToFileURL(path.join(outDir, entry.fileName)).href)};
      process.once('uncaughtException', error => { console.error(error.stack); process.exit(1); });
      const terminal = new Terminal({ allowProposedApi: true });
      terminal.loadAddon(new FitAddon());
      const replies = [];
      terminal.onData(data => replies.push(data));
      const timeout = setTimeout(() => { throw new Error('Terminal parser stalled after mode query.'); }, 2000);
      terminal.write('\u001b[?12$p\u001b[4$p', () => {
        terminal.write('ready', () => {
          terminal.input('i');
          terminal.input('\u001bOA');
          console.log(JSON.stringify({ replies, text: terminal.buffer.active.getLine(0).translateToString(true) }));
          clearTimeout(timeout);
          terminal.dispose();
        });
      });
    `], { timeout: 5000 });

    expect(JSON.parse(stdout)).toEqual({
      replies: ['\u001b[?12;2$y', '\u001b[4;2$y', 'i', '\u001bOA'],
      text: 'ready',
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
