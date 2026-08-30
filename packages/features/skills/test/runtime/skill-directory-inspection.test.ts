import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectSkillDirectoryPaths } from '../../src/runtime/skill-directory-inspection.js';

describe('inspectSkillDirectoryPaths', () => {
  it('counts direct Skill directories and treats missing roots as empty', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-skill-inspection-'));
    const missingRoot = path.join(fixtureRoot, 'missing');
    try {
      await mkdir(path.join(fixtureRoot, 'active-skill'), { recursive: true });
      await mkdir(path.join(fixtureRoot, 'ordinary-folder'), { recursive: true });
      await writeFile(path.join(fixtureRoot, 'active-skill', 'SKILL.md'), '# Active', 'utf8');

      await expect(inspectSkillDirectoryPaths([fixtureRoot, missingRoot])).resolves.toEqual({
        directories: [
          { path: fixtureRoot, skillCount: 1 },
          { path: missingRoot, skillCount: 0 },
        ],
      });
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});
