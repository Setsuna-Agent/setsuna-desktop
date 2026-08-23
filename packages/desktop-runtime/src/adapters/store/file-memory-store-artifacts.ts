import type { RuntimeMemorySourceLocation } from '@setsuna-desktop/feature-memory/contracts';
import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveConfinedPathWithoutSymlinks } from '../../security/path-confinement.js';
import { isNodeErrorCode } from '../../shared/node-errors.js';
import {
  MEMORY_MARKDOWN_FILE_NAME,
  MEMORY_SUMMARY_FILE_NAME,
  SKILLS_DIR_NAME,
} from './file-memory-store-constants.js';

export type RenderedMemoryArtifacts = {
  files: Map<string, string>;
  locations: Map<string, RuntimeMemorySourceLocation>;
};

export async function shouldPreserveExistingArtifact(root: string, relativePath: string): Promise<boolean> {
  if (relativePath !== MEMORY_MARKDOWN_FILE_NAME && relativePath !== MEMORY_SUMMARY_FILE_NAME) return false;
  const target = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativePath), { label: 'Memory artifact' });
  let content = '';
  try {
    content = await readFile(target, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
  // Phase two output is the persistent source of truth; only generated fallbacks are refreshed.
  return !content.includes('Generated from memories.json.');
}

export async function overlayStoredMemoryArtifacts(
  artifacts: RenderedMemoryArtifacts,
  root: string,
): Promise<RenderedMemoryArtifacts> {
  const files = new Map(artifacts.files);
  await overlayStoredFile(files, root, MEMORY_MARKDOWN_FILE_NAME);
  await overlayStoredFile(files, root, MEMORY_SUMMARY_FILE_NAME);
  await overlayStoredDirectory(files, root, SKILLS_DIR_NAME);
  return { ...artifacts, files };
}

export async function overlayStoredFile(
  files: Map<string, string>,
  root: string,
  relativePath: string,
): Promise<void> {
  try {
    const target = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativePath), { label: 'Memory artifact' });
    files.set(relativePath, await readFile(target, 'utf8'));
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }
}

export async function overlayStoredDirectory(
  files: Map<string, string>,
  root: string,
  relativeDir: string,
): Promise<void> {
  const dir = await resolveConfinedPathWithoutSymlinks(root, path.join(root, relativeDir), { label: 'Memory artifact' });
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith('.')) return;
    const relativePath = path.posix.join(relativeDir, entry.name);
    const absolutePath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      await overlayStoredDirectory(files, root, relativePath);
      return;
    }
    if (!entry.isFile()) return;
    files.set(relativePath, await readFile(absolutePath, 'utf8'));
  }));
}
