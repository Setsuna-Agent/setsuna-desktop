import { readFile } from 'node:fs/promises';
import path from 'node:path';

type ApplicationLocation = {
  identity: string;
  suffix: string;
};

type PackagedApplicationLocation = ApplicationLocation & {
  /** Path up to and including app.asar; its package.json carries the app identity. */
  root: string;
};

// electron-builder unpacked output directories (win-unpacked, linux-unpacked, …)
// share the same names across products, so the directory name alone cannot prove
// both paths belong to the same application.
const GENERIC_UNPACKED_DIRECTORY = /^(?:win(?:-(?:ia32|x64|arm64))?-unpacked|linux(?:-(?:arm|armv7l|arm64|x64))?-unpacked|mac(?:-(?:x64|arm64|universal))?)$/u;

/**
 * Legacy plugin records predate the persisted marketplace provenance. The
 * catalog can move between a source checkout and a packaged application (or
 * between two packaged locations), so an exact absolute-path comparison is not
 * enough to recover those records after an upgrade.
 */
export async function sameLegacyMarketplaceSource(left: string, right: string): Promise<boolean> {
  if (samePath(left, right)) return true;

  const leftAppImage = appImageApplicationLocation(left);
  const rightAppImage = appImageApplicationLocation(right);
  if (sameApplicationLocation(leftAppImage, rightAppImage)) return true;

  const leftPackaged = packagedApplicationLocation(left);
  const rightPackaged = packagedApplicationLocation(right);
  if (await samePackagedApplicationLocation(leftPackaged, rightPackaged)) return true;

  const leftCatalog = catalogApplicationLocation(left);
  const rightCatalog = catalogApplicationLocation(right);
  if (!leftCatalog || !rightCatalog || !samePath(leftCatalog.suffix, rightCatalog.suffix)) return false;

  const [leftIdentity, rightIdentity] = await Promise.all([
    readApplicationIdentity(leftCatalog.root),
    readApplicationIdentity(rightCatalog.root),
  ]);
  return sameApplicationIdentity(leftIdentity, rightIdentity);
}

function sameApplicationLocation(left: ApplicationLocation | null, right: ApplicationLocation | null): boolean {
  return Boolean(left && right && left.identity === right.identity && samePath(left.suffix, right.suffix));
}

/**
 * A product-named install directory or `<Name>.app` is already a strong identity
 * and the old install location may have been deleted, so it cannot rely on
 * reading files there. Generic build-output directory names are weak identities:
 * require the packaged applications' package identities (appId or name) to
 * overlap before reclaiming the record.
 */
async function samePackagedApplicationLocation(
  left: PackagedApplicationLocation | null,
  right: PackagedApplicationLocation | null,
): Promise<boolean> {
  if (!sameApplicationLocation(left, right) || !left || !right) return false;
  if (!GENERIC_UNPACKED_DIRECTORY.test(left.identity)) return true;
  const [leftIdentity, rightIdentity] = await Promise.all([
    readApplicationIdentity(left.root),
    readApplicationIdentity(right.root),
  ]);
  return sameApplicationIdentity(leftIdentity, rightIdentity);
}

function catalogApplicationLocation(value: string): { root: string; suffix: string } | null {
  const pluginRoot = path.resolve(value);
  const catalogRoot = path.dirname(pluginRoot);
  if (path.basename(catalogRoot).toLowerCase() !== 'plugins') return null;
  return {
    root: path.dirname(catalogRoot),
    suffix: path.join('plugins', path.basename(pluginRoot)),
  };
}

type ApplicationIdentity = {
  appId?: string;
  name?: string;
};

async function readApplicationIdentity(applicationRoot: string): Promise<ApplicationIdentity | null> {
  try {
    const value = JSON.parse(await readFile(path.join(applicationRoot, 'package.json'), 'utf8')) as {
      build?: { appId?: unknown };
      name?: unknown;
    };
    const appId = normalizeIdentityField(value.build?.appId);
    const name = normalizeIdentityField(value.name);
    if (!appId && !name) return null;
    return { ...(appId ? { appId } : {}), ...(name ? { name } : {}) };
  } catch {
    return null;
  }
}

function normalizeIdentityField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

/**
 * appId is the strong identity: when both packages declare one, differing IDs
 * veto the weaker name fallback. A missing appId must not veto, because
 * electron-builder can strip the `build` section from the packaged package.json.
 */
function sameApplicationIdentity(
  left: ApplicationIdentity | null,
  right: ApplicationIdentity | null,
): boolean {
  if (!left || !right) return false;
  if (left.appId && right.appId) return left.appId === right.appId;
  return Boolean(left.name && left.name === right.name);
}

function packagedApplicationLocation(value: string): PackagedApplicationLocation | null {
  const segments = path.resolve(value).split(path.sep);
  const appAsarIndex = segments.findIndex((segment) => segment.toLowerCase() === 'app.asar');
  if (appAsarIndex < 2 || segments[appAsarIndex - 1].toLowerCase() !== 'resources') return null;

  const root = segments.slice(0, appAsarIndex + 1).join(path.sep);
  const macContentsIndex = appAsarIndex - 2;
  const macApplicationIndex = appAsarIndex - 3;
  if (
    segments[macContentsIndex]?.toLowerCase() === 'contents'
    && segments[macApplicationIndex]?.toLowerCase().endsWith('.app')
  ) {
    return {
      identity: segments[macApplicationIndex].toLowerCase(),
      suffix: segments.slice(macContentsIndex).join(path.sep),
      root,
    };
  }

  const applicationDirectory = segments[appAsarIndex - 2];
  if (!applicationDirectory) return null;
  return {
    identity: applicationDirectory.toLowerCase(),
    suffix: segments.slice(appAsarIndex - 1).join(path.sep),
    root,
  };
}

function appImageApplicationLocation(value: string): ApplicationLocation | null {
  const segments = path.resolve(value).split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    const match = /^\.mount_(.+)[a-z0-9]{6}$/iu.exec(segments[index]);
    if (!match) continue;
    const appAsarIndex = segments.findIndex(
      (segment, candidateIndex) => candidateIndex > index && segment.toLowerCase() === 'app.asar',
    );
    if (appAsarIndex < 0) return null;
    // AppImage replaces only the six-character mount suffix between launches.
    return {
      identity: match[1].toLowerCase(),
      suffix: segments.slice(appAsarIndex).join(path.sep),
    };
  }
  return null;
}

export function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
