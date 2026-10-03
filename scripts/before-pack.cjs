const { pathToFileURL } = require('node:url');

exports.default = async function beforePack(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'win32') {
    throw new Error(`Setsuna Desktop supports macOS and Windows only. Unsupported packaging target: ${context.electronPlatformName}.`);
  }
  const moduleUrl = pathToFileURL(require.resolve('./ripgrep/prepare-ripgrep.mjs')).href;
  const { electronBuilderArchName, prepareRipgrep } = await import(moduleUrl);
  if (context.electronPlatformName === 'darwin') {
    const { buildMacComputerHelper } = await import(pathToFileURL(require.resolve('./build-computer-use-mac.mjs')).href);
    await buildMacComputerHelper({ arch: electronBuilderArchName(context.arch), projectDir: context.packager.projectDir });
  }
  await prepareRipgrep({
    platform: context.electronPlatformName,
    arch: electronBuilderArchName(context.arch),
    projectDir: context.packager.projectDir,
  });
  if (context.electronPlatformName === 'win32') {
    const { buildWindowsComputerHelper } = await import(pathToFileURL(require.resolve('./build-computer-use-windows.mjs')).href);
    await buildWindowsComputerHelper({ arch: electronBuilderArchName(context.arch), projectDir: context.packager.projectDir });
    const curlModuleUrl = pathToFileURL(require.resolve('./windows-sandbox/prepare-sandbox-curl.mjs')).href;
    const { prepareSandboxCurl } = await import(curlModuleUrl);
    await prepareSandboxCurl({
      platform: context.electronPlatformName,
      arch: electronBuilderArchName(context.arch),
      projectDir: context.packager.projectDir,
    });
    const sandboxModuleUrl = pathToFileURL(require.resolve('./windows-sandbox/prepare-windows-sandbox.mjs')).href;
    const { prepareWindowsSandbox } = await import(sandboxModuleUrl);
    await prepareWindowsSandbox({
      platform: context.electronPlatformName,
      arch: electronBuilderArchName(context.arch),
      projectDir: context.packager.projectDir,
    });
  }
};
