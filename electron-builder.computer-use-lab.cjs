const { build } = require('./package.json');

// TCC identifies ad-hoc builds by their changing CDHash. Never grant the lab
// the release bundle ID, or silently fall back to an ad-hoc signature.
if (!process.env.CSC_NAME || process.env.CSC_NAME === '-') {
  throw new Error('Set CSC_NAME to a stable macOS code-signing identity before packaging the computer-use lab.');
}

module.exports = {
  ...build,
  appId: 'dev.setsuna.desktop.computer-use-lab',
  productName: 'Setsuna Computer Use Lab',
  extraMetadata: { name: 'setsuna-computer-use-lab', productName: 'Setsuna Computer Use Lab' },
  directories: { ...build.directories, output: 'release-artifacts/computer-use-lab' },
  forceCodeSigning: true,
  publish: null,
  mac: { ...build.mac, identity: process.env.CSC_NAME, notarize: false },
};
