import packageJson from '../package.json' with { type: 'json' };

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

const packageVersion = packageJson.version;
const releaseTag = process.env.RELEASE_TAG?.trim() || '';

if (!SEMVER_PATTERN.test(packageVersion)) {
  throw new Error(`Invalid package version: ${JSON.stringify(packageVersion)}. Use SemVer, for example 0.1.5 or 0.1.4-fix.1.`);
}

if (releaseTag) {
  const normalizedTag = releaseTag.replace(/^v/u, '');
  if (normalizedTag !== packageVersion) {
    throw new Error(`Release tag ${JSON.stringify(releaseTag)} does not match package version ${JSON.stringify(packageVersion)}.`);
  }
}

console.log(`Release version is valid: ${releaseTag || `v${packageVersion}`}`);
