const { pathToFileURL } = require('node:url');

exports.default = async function beforePack(context) {
  const moduleUrl = pathToFileURL(require.resolve('./ripgrep/prepare-ripgrep.mjs')).href;
  const { electronBuilderArchName, prepareRipgrep } = await import(moduleUrl);
  await prepareRipgrep({
    platform: context.electronPlatformName,
    arch: electronBuilderArchName(context.arch),
    projectDir: context.packager.projectDir,
  });
};
