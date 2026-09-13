import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { objectRecord } from './file-plugin-bundle-values.js';

export const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024;

export async function bundlePathExists(root: string, relativePath: string): Promise<boolean> {
  const target = path.join(root, safeRelativePath(relativePath, 'Plugin path'));
  return lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

export async function readPluginJson(root: string, relativePath: string): Promise<Record<string, unknown>> {
  const filePath = await safeExistingPath(root, relativePath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Plugin configuration must be a file: ${relativePath}`);
  if (fileStat.size > MAX_PLUGIN_MANIFEST_BYTES) throw new Error('Plugin manifest is too large.');
  const content = await readFile(filePath);
  if (content.byteLength > MAX_PLUGIN_MANIFEST_BYTES) throw new Error('Plugin manifest is too large.');
  return objectRecord(JSON.parse(content.toString('utf8')), `Plugin configuration must be a JSON object: ${relativePath}`);
}

export async function safeExistingPath(root: string, relativePath: string): Promise<string> {
  // macOS exposes /var through /private/var; compare canonical paths on both sides.
  const resolvedRoot = await realpath(root);
  const normalizedRelativePath = safeRelativePath(relativePath, 'Plugin path');
  const displayPath = relativePath.replaceAll('\\', '/');
  let exactPath = resolvedRoot;
  for (const segment of normalizedRelativePath.split(path.sep).filter((segment) => segment && segment !== '.')) {
    const entries = await readdir(exactPath);
    if (!entries.includes(segment)) {
      const caseVariant = entries.find((entry) => entry.toLowerCase() === segment.toLowerCase());
      if (caseVariant) throw new Error(`Plugin path casing does not match the bundle: ${displayPath}`);
      throw new Error(`Plugin path does not exist: ${displayPath}`);
    }
    exactPath = path.join(exactPath, segment);
    const target = await realpath(exactPath);
    if (!pathIsInside(resolvedRoot, target)) throw new Error(`Plugin path escapes the bundle: ${displayPath}`);
  }
  return realpath(exactPath);
}

export function safeRelativePath(value: string, label: string): string {
  // Validate both path syntaxes so a bundle behaves the same on every desktop OS.
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-z]:/iu.test(value)) {
    throw new Error(`${label} must be relative.`);
  }
  const normalized = path.normalize(value.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error(`${label} escapes the bundle.`);
  return normalized;
}

export function pathsOverlap(left: string, right: string): boolean {
  return pathIsInside(left, right) || pathIsInside(right, left);
}

export function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
