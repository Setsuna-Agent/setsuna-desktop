import { readFile } from 'node:fs/promises';
import path from 'node:path';

type ApplicationLocation = {
  identity: string;
  suffix: string;
};

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
  if (sameApplicationLocation(leftPackaged, rightPackaged)) return true;

  const leftCatalog = catalogApplicationLocation(left);
  const rightCatalog = catalogApplicationLocation(right);
  if (!leftCatalog || !rightCatalog || !samePath(leftCatalog.suffix, rightCatalog.suffix)) return false;

  const [leftIdentities, rightIdentities] = await Promise.all([
    readApplicationIdentities(leftCatalog.root),
    readApplicationIdentities(rightCatalog.root),
  ]);
  return leftIdentities.some((identity) => rightIdentities.includes(identity));
}

function sameApplicationLocation(left: ApplicationLocation | null, right: ApplicationLocation | null): boolean {
  return Boolean(left && right && left.identity === right.identity && samePath(left.suffix, right.suffix));
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

async function readApplicationIdentities(applicationRoot: string): Promise<string[]> {
  try {
    const value = JSON.parse(await readFile(path.join(applicationRoot, 'package.json'), 'utf8')) as {
      build?: { appId?: unknown };
      name?: unknown;
    };
    return [value.build?.appId, value.name]
      .filter((identity): identity is string => typeof identity === 'string' && Boolean(identity.trim()))
      .map((identity) => identity.trim().toLowerCase());
  } catch {
    return [];
  }
}

function packagedApplicationLocation(value: string): ApplicationLocation | null {
  const segments = path.resolve(value).split(path.sep);
  const appAsarIndex = segments.findIndex((segment) => segment.toLowerCase() === 'app.asar');
  if (appAsarIndex < 2 || segments[appAsarIndex - 1].toLowerCase() !== 'resources') return null;

  const macContentsIndex = appAsarIndex - 2;
  const macApplicationIndex = appAsarIndex - 3;
  if (
    segments[macContentsIndex]?.toLowerCase() === 'contents'
    && segments[macApplicationIndex]?.toLowerCase().endsWith('.app')
  ) {
    return {
      identity: segments[macApplicationIndex].toLowerCase(),
      suffix: segments.slice(macContentsIndex).join(path.sep),
    };
  }

  const applicationDirectory = segments[appAsarIndex - 2];
  if (!applicationDirectory) return null;
  return {
    identity: applicationDirectory.toLowerCase(),
    suffix: segments.slice(appAsarIndex - 1).join(path.sep),
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
