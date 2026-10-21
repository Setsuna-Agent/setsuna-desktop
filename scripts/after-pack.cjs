const { spawnSync } = require('node:child_process');
const { cp, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

exports.default = async function afterPack(context) {
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const { verifyComputerUseResources } = await import(pathToFileURL(require.resolve('./computer-use-resources.mjs')).href);
  const moduleUrl = pathToFileURL(require.resolve('./ripgrep/prepare-ripgrep.mjs')).href;
  const { electronBuilderArchName, verifyPreparedRipgrep } = await import(moduleUrl);
  await verifyComputerUseResources({ resourcesDir, platform: context.electronPlatformName, arch: electronBuilderArchName(context.arch) });
  await verifyPreparedRipgrep({
    platform: context.electronPlatformName,
    arch: electronBuilderArchName(context.arch),
    projectDir: context.packager.projectDir,
    destination: path.join(resourcesDir, 'setsuna-path'),
  });

  if (context.electronPlatformName === 'win32') {
    const curlModuleUrl = pathToFileURL(require.resolve('./windows-sandbox/prepare-sandbox-curl.mjs')).href;
    const { verifyPreparedSandboxCurl } = await import(curlModuleUrl);
    await verifyPreparedSandboxCurl({
      projectDir: context.packager.projectDir,
      destination: path.join(resourcesDir, 'setsuna-path'),
      execute: true,
    });
    const sandboxModuleUrl = pathToFileURL(require.resolve('./windows-sandbox/prepare-windows-sandbox.mjs')).href;
    const { verifyPreparedWindowsSandbox } = await import(sandboxModuleUrl);
    await verifyPreparedWindowsSandbox({
      projectDir: context.packager.projectDir,
      destination: path.join(resourcesDir, 'setsuna-sandbox'),
      execute: true,
    });
  }

  // Keep local packages runnable without a certificate. electron-builder replaces
  // this fallback with a Developer ID signature when it finds a signing identity.
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  if (context.electronPlatformName === 'darwin' && process.env.SETSUNA_DESKTOP_SKIP_ADHOC_SIGN !== '1'
    && !process.env.CSC_LINK && !process.env.CSC_NAME) {
    run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
  }

  // Release runners package their native target, so this checks the actual
  // shipped dependency tree and compiler rather than resolving the checkout.
  if (context.electronPlatformName === process.platform && electronBuilderArchName(context.arch) === process.arch) {
    const executable = context.electronPlatformName === 'darwin'
      ? path.join(appPath, 'Contents', 'MacOS', context.packager.appInfo.productFilename)
      : path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
    // CI builds inside the checkout. Isolate the archive so Node cannot satisfy
    // a missing packaged dependency from the repository's ancestor node_modules.
    const smokeRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-packaged-runtime-'));
    try {
      for (const name of ['app.asar', 'app.asar.unpacked']) {
        await cp(path.join(resourcesDir, name), path.join(smokeRoot, name), { recursive: true });
      }
      run(executable, [require.resolve('./verify-packaged-runtime.cjs'), path.join(smokeRoot, 'app.asar')], {
        cwd: smokeRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '' }, timeout: 30_000,
      });
    } finally {
      await rm(smokeRoot, { recursive: true, force: true });
    }
  }
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', stdio: 'pipe' });
  if (result.status === 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) console.log(output);
    return;
  }

  throw new Error(
    [
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}
