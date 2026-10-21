const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { access, mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const path = require('node:path');

// Run with the packaged Electron binary: host Node cannot load its native ABI
// or ASAR paths, and repository dependencies must not hide missing shipped files.
async function verify() {
  assert.ok(process.versions.electron, 'Use the packaged Electron with ELECTRON_RUN_AS_NODE=1.');
  const archive = path.resolve(process.argv[2]);
  const requireFromApp = createRequire(path.join(archive, 'package.json'));
  assert.equal(typeof requireFromApp('node-pty').spawn, 'function');
  assert.equal(typeof requireFromApp('proxy-chain').Server, 'function');
  assert.equal(typeof requireFromApp('undici').Agent, 'function');
  requireFromApp.resolve('electron-chrome-web-store');
  const corepack = path.dirname(requireFromApp.resolve('corepack/package.json'));
  await access(path.join(corepack, 'dist/pnpm.js'));
  const png = await requireFromApp('sharp')({ create: { width: 1, height: 1, channels: 4, background: '#000' } }).png().toBuffer();
  assert.equal(png.subarray(1, 4).toString(), 'PNG');

  const sdk = path.dirname(requireFromApp.resolve('@setsuna/app/package.json'));
  const sdkManifest = JSON.parse(await readFile(path.join(sdk, 'dist/package.json'), 'utf8'));
  assert.equal(sdkManifest.dependencies['@setsuna-desktop/renderer-ui'], 'file:dist/renderer-ui');
  for (const file of ['index.js', 'index.d.ts', 'styles.css', 'renderer-ui/dist/index.js', 'renderer-ui/dist/index.d.ts']) {
    await access(path.join(sdk, 'dist', file));
  }

  const project = await mkdtemp(path.join(tmpdir(), 'setsuna-packaged-compiler-'));
  try {
    await mkdir(path.join(project, '.setsuna'));
    await writeFile(path.join(project, 'package.json'), '{"name":"setsuna-packaged-probe","type":"module"}');
    await writeFile(path.join(project, 'styles.css'), '.packaged-probe { color: rgb(1, 2, 3); }');
    await writeFile(path.join(project, '.setsuna/main.tsx'),
      "import '../styles.css'; const value: string = 'setsuna-packaged-compiler'; document.body.textContent = value;");
    const result = await compile(path.join(archive, 'dist/runtime/plugin-app-build-worker.js'), project);
    assert.equal(result?.ok, true, result?.error);
    assert.ok(result.source.js.includes('setsuna-packaged-compiler'));
    assert.ok(result.source.css.includes('packaged-probe'));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
  console.log('Packaged runtime passed: native modules, network dependencies, Corepack, app SDK and Vite compiler.');
}

function compile(worker, project) {
  return new Promise((resolve, reject) => {
    const child = fork(worker, [project], { execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let result;
    child.on('message', message => { result = message; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Packaged app compiler timed out.'));
    }, 20_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(result);
      else reject(new Error(result?.error ?? `Packaged app compiler exited with ${code ?? signal}.`));
    });
  });
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
