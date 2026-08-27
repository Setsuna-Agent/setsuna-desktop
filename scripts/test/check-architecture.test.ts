import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Architecture checker', () => {
  it('enforces the unreviewed module limit in Feature source trees', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-architecture-'));
    try {
      await writeFiles(root, {
        'packages/features/example/package.json': JSON.stringify({
          name: '@setsuna-desktop/feature-example',
          version: '0.1.0',
          exports: {
            './contracts': './dist/contracts/index.js',
            './runtime': './dist/runtime/index.js',
          },
        }),
        'packages/features/example/src/contracts/definition.ts': `
          import { defineFeature } from '@setsuna-desktop/feature-core/definition';
          export const exampleFeature = defineFeature('example');
        `,
        'packages/features/example/src/runtime/oversized.ts': Array.from(
          { length: 901 },
          (_, index) => `export const value${index} = ${index};`,
        ).join('\n'),
      });

      const scriptPath = path.resolve('scripts/check-architecture.mjs');
      let stderr = '';
      try {
        await execFileAsync(process.execPath, [scriptPath, root]);
      } catch (error) {
        stderr = String((error as { stderr?: string }).stderr ?? '');
      }

      expect(stderr).toContain(
        'packages/features/example/src/runtime/oversized.ts: 901 lines exceeds the 900-line unreviewed-module limit.',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content.trimStart(), 'utf8');
  }
}
