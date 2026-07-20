const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

exports.default = async function afterPack(context) {
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const moduleUrl = pathToFileURL(require.resolve('./ripgrep/prepare-ripgrep.mjs')).href;
  const { electronBuilderArchName, verifyPreparedRipgrep } = await import(moduleUrl);
  await verifyPreparedRipgrep({
    platform: context.electronPlatformName,
    arch: electronBuilderArchName(context.arch),
    projectDir: context.packager.projectDir,
    destination: path.join(resourcesDir, 'setsuna-path'),
  });

  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.SETSUNA_DESKTOP_SKIP_ADHOC_SIGN === '1') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
};

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.status === 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) console.log(output);
    return;
  }

  throw new Error(
    [
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}
