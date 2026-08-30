import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SkillDirectoryInspectionResult } from '../contracts/index.js';

/** Counts exactly the direct child Skill directories the current registry can inherit. */
export async function inspectSkillDirectoryPaths(
  paths: readonly string[],
): Promise<SkillDirectoryInspectionResult> {
  const directories = await Promise.all(paths.map(async (root) => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    let skillCount = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = await stat(path.join(root, entry.name, 'SKILL.md')).catch(() => null);
      if (skillFile?.isFile()) skillCount += 1;
    }
    return Object.freeze({ path: root, skillCount });
  }));
  return Object.freeze({ directories });
}
