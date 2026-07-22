import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileProjectInstructionLoader } from '../../../src/adapters/workspace/file-project-instruction-loader.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('FileProjectInstructionLoader', () => {
  it('loads root-to-cwd instructions and prefers an override in the same directory', async () => {
    const root = await temporaryProject();
    const nested = path.join(root, 'packages', 'app');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, 'AGENTS.override.md'), '  \n');
    await writeFile(path.join(root, 'AGENTS.md'), 'root instructions');
    await writeFile(path.join(nested, 'AGENTS.md'), 'ignored sibling instructions');
    await writeFile(path.join(nested, 'AGENTS.override.md'), 'nested override');
    const loader = loaderFor();

    await expect(loader.load({ environment: testEnvironment(root, nested) })).resolves.toEqual([
      expect.objectContaining({ content: 'root instructions', directory: root, path: path.join(root, 'AGENTS.md'), truncated: false }),
      expect.objectContaining({ content: 'nested override', directory: nested, path: path.join(nested, 'AGENTS.override.md'), truncated: false }),
    ]);
  });

  it('honors the total byte budget and optional fallback filename', async () => {
    const root = await temporaryProject();
    await writeFile(path.join(root, 'PROJECT_RULES.md'), '1234567890');
    const loader = loaderFor();

    const result = await loader.load({ environment: testEnvironment(root), fallbackFilenames: ['PROJECT_RULES.md'], maxBytes: 5 });

    expect(result).toEqual([
      expect.objectContaining({ content: '12345', path: path.join(root, 'PROJECT_RULES.md'), truncated: true }),
    ]);
  });

  it.skipIf(process.platform === 'win32')('does not follow instruction-file symlinks outside the workspace', async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    const outsideInstructions = path.join(outside, 'AGENTS.md');
    await writeFile(outsideInstructions, 'outside instructions');
    await symlink(outsideInstructions, path.join(root, 'AGENTS.md'));

    await expect(loaderFor().load({ environment: testEnvironment(root) })).resolves.toEqual([]);
  });
});

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-project-instructions-'));
  temporaryDirectories.push(directory);
  return realpath(directory);
}

function loaderFor(): FileProjectInstructionLoader {
  return new FileProjectInstructionLoader();
}

function testEnvironment(root: string, cwd = root): RuntimeEnvironment {
  return {
    id: 'project_1',
    cwd,
    workspaceRoot: root,
    workspaceRoots: [root],
  };
}
