export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type ReleaseInfo = {
  tag_name: string;
  name?: string | null;
  html_url?: string | null;
  assets: ReleaseAsset[];
};

export type UpdatePlatform = NodeJS.Platform;

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/iu, '');
}

export function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left).split(/[.-]/u);
  const rightParts = normalizeVersion(right).split(/[.-]/u);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? '0';
    const rightPart = rightParts[index] ?? '0';
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber > rightNumber) return 1;
      if (leftNumber < rightNumber) return -1;
      continue;
    }

    const textComparison = leftPart.localeCompare(rightPart);
    if (textComparison !== 0) return textComparison > 0 ? 1 : -1;
  }

  return 0;
}

export function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  return compareVersions(latestVersion, currentVersion) > 0;
}

export function selectUpdateAsset(assets: ReleaseAsset[], platform: UpdatePlatform, arch: string): ReleaseAsset | null {
  const scoredAssets = assets
    .map((asset) => ({ asset, score: scoreAsset(asset.name, platform, arch) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.asset.name.localeCompare(right.asset.name));

  return scoredAssets[0]?.asset ?? null;
}

export function parseSha256Sums(content: string): Map<string, string> {
  const checksums = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/iu.exec(line);
    if (!match) continue;
    checksums.set(match[2].trim(), match[1].toLowerCase());
  }

  return checksums;
}

export function checksumForAsset(checksums: Map<string, string>, assetName: string): string | null {
  return checksums.get(assetName) ?? checksums.get(assetName.replace(/\\/gu, '/')) ?? null;
}

function scoreAsset(name: string, platform: UpdatePlatform, arch: string): number {
  const lowerName = name.toLowerCase();
  const normalizedArch = arch === 'x64' || arch === 'arm64' ? arch : 'x64';

  if (platform === 'darwin') {
    if (!lowerName.includes('mac') || !lowerName.includes(normalizedArch)) return 0;
    if (lowerName.endsWith('.dmg')) return 120;
    if (lowerName.endsWith('.zip')) return 80;
    return 10;
  }

  if (platform === 'win32') {
    if (!lowerName.includes('windows') || !lowerName.includes('x64')) return 0;
    if (lowerName.endsWith('.exe')) return 120;
    if (lowerName.endsWith('.msi')) return 100;
    if (lowerName.endsWith('.zip')) return 70;
    return 10;
  }

  if (platform === 'linux') {
    if (!lowerName.includes('ubuntu') || !lowerName.includes('x64')) return 0;
    if (lowerName.endsWith('.appimage')) return 120;
    if (lowerName.endsWith('.deb')) return 100;
    if (lowerName.endsWith('.tar.gz')) return 70;
    return 10;
  }

  return 0;
}
