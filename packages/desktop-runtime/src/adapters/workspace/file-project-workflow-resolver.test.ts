import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';
import { FileProjectWorkflowResolver } from './file-project-workflow-resolver.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('FileProjectWorkflowResolver', () => {
  it('resolves the package manager and nearest relevant scripts before command execution', async () => {
    const root = await temporaryProject();
    const nested = path.join(root, 'packages', 'app');
    await mkdir(nested, { recursive: true });
    await writeJson(path.join(root, 'package.json'), {
      packageManager: 'pnpm@7.33.7',
      scripts: {
        build: 'tsc -b',
        test: 'pnpm test:unit && pnpm test:integration',
        'test:unit': 'vitest run --config vitest.unit.config.ts',
      },
    });
    await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 6\n');
    await writeJson(path.join(nested, 'package.json'), {
      scripts: {
        lint: 'eslint src',
        test: 'vitest run --config vitest.package.config.ts',
      },
    });

    const workflow = await new FileProjectWorkflowResolver().resolve({ environment: testEnvironment(root, nested) });

    expect(workflow?.packageManager).toEqual({
      name: 'pnpm',
      version: '7.33.7',
      evidence: ['package.json#packageManager', 'pnpm-lock.yaml'],
    });
    expect(workflow?.manifests.map((manifest) => manifest.path)).toEqual([
      path.join(root, 'package.json'),
      path.join(nested, 'package.json'),
    ]);
    expect(workflow?.scripts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'test',
        invocation: 'pnpm test',
        definition: 'vitest run --config vitest.package.config.ts',
        cwd: nested,
        sourcePath: path.join(nested, 'package.json'),
      }),
      expect.objectContaining({
        name: 'test:unit',
        invocation: 'pnpm run test:unit',
        definition: 'vitest run --config vitest.unit.config.ts',
        cwd: root,
      }),
      expect.objectContaining({ name: 'build', invocation: 'pnpm build', cwd: root }),
    ]));
  });

  it.each([
    ['npm@10.8.0', 'npm test', 'npm run lint'],
    ['yarn@4.3.1', 'yarn test', 'yarn lint'],
    ['bun@1.1.20', 'bun run test', 'bun run lint'],
  ])('derives declared script invocations for %s', async (packageManager, testInvocation, lintInvocation) => {
    const root = await temporaryProject();
    await writeJson(path.join(root, 'package.json'), {
      packageManager,
      scripts: { test: 'runner test', lint: 'runner lint' },
    });

    const workflow = await new FileProjectWorkflowResolver().resolve({ environment: testEnvironment(root) });

    expect(workflow?.scripts.find((script) => script.name === 'test')?.invocation).toBe(testInvocation);
    expect(workflow?.scripts.find((script) => script.name === 'lint')?.invocation).toBe(lintInvocation);
  });

  it('uses the package manager that applies at each script manifest scope', async () => {
    const root = await temporaryProject();
    const nested = path.join(root, 'packages', 'standalone');
    await mkdir(nested, { recursive: true });
    await writeJson(path.join(root, 'package.json'), {
      packageManager: 'pnpm@7.33.7',
      scripts: { build: 'tsc -b' },
    });
    await writeJson(path.join(nested, 'package.json'), {
      packageManager: 'npm@10.8.0',
      scripts: { test: 'vitest run' },
    });

    const workflow = await new FileProjectWorkflowResolver().resolve({ environment: testEnvironment(root, nested) });

    expect(workflow?.packageManager?.name).toBe('npm');
    expect(workflow?.scripts.find((script) => script.name === 'build')?.invocation).toBe('pnpm build');
    expect(workflow?.scripts.find((script) => script.name === 'test')?.invocation).toBe('npm test');
    expect(workflow?.warnings).toContainEqual(expect.stringContaining('conflicting evidence'));
  });

  it('does not guess when lockfiles conflict at the effective scope', async () => {
    const root = await temporaryProject();
    await writeJson(path.join(root, 'package.json'), { scripts: { test: 'vitest run' } });
    await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 6\n');
    await writeFile(path.join(root, 'yarn.lock'), '# yarn lockfile\n');

    const workflow = await new FileProjectWorkflowResolver().resolve({ environment: testEnvironment(root) });

    expect(workflow?.packageManager).toBeUndefined();
    expect(workflow?.scripts[0]).not.toHaveProperty('invocation');
    expect(workflow?.warnings).toContainEqual(expect.stringContaining('Conflicting lockfile package-manager evidence'));
  });

  it('bounds relevant script count and individual definitions', async () => {
    const root = await temporaryProject();
    const scripts = Object.fromEntries(Array.from({ length: 25 }, (_value, index) => [
      `test:case-${String(index).padStart(2, '0')}`,
      `runner ${'x'.repeat(600)}`,
    ]));
    await writeJson(path.join(root, 'package.json'), { packageManager: 'pnpm@7.33.7', scripts });

    const workflow = await new FileProjectWorkflowResolver().resolve({ environment: testEnvironment(root) });

    expect(workflow?.scripts).toHaveLength(20);
    expect(workflow?.scripts.every((script) => Buffer.byteLength(script.definition, 'utf8') <= 512)).toBe(true);
    expect(workflow?.scripts.every((script) => script.truncated)).toBe(true);
    expect(workflow?.warnings).toContainEqual(expect.stringContaining('Truncated 25 script definitions'));
    expect(workflow?.warnings).toContainEqual(expect.stringContaining('only the first 20 are included'));
  });

  it('invalidates cached workflow data when a manifest changes', async () => {
    const root = await temporaryProject();
    const manifestPath = path.join(root, 'package.json');
    const resolver = new FileProjectWorkflowResolver();
    await writeJson(manifestPath, { packageManager: 'pnpm@7.33.7', scripts: { test: 'vitest run' } });
    const first = await resolver.resolve({ environment: testEnvironment(root) });

    await writeJson(manifestPath, {
      packageManager: 'pnpm@7.33.7',
      scripts: { test: 'vitest run --config vitest.unit.config.ts' },
    });
    const second = await resolver.resolve({ environment: testEnvironment(root) });

    expect(first?.scripts[0]?.definition).toBe('vitest run');
    expect(second?.scripts[0]?.definition).toContain('vitest.unit.config.ts');
  });

  it('bounds deep ancestry while retaining root and nearest workflow evidence', async () => {
    const root = await temporaryProject();
    const nested = path.join(root, ...Array.from({ length: 35 }, (_value, index) => `level-${index}`));
    await mkdir(nested, { recursive: true });
    await writeJson(path.join(root, 'package.json'), {
      packageManager: 'pnpm@7.33.7',
      scripts: { build: 'tsc -b' },
    });
    await writeJson(path.join(nested, 'package.json'), { scripts: { test: 'vitest run' } });

    const workflow = await new FileProjectWorkflowResolver().resolve({ environment: testEnvironment(root, nested) });

    expect(workflow?.manifests.map((manifest) => manifest.path)).toEqual([
      path.join(root, 'package.json'),
      path.join(nested, 'package.json'),
    ]);
    expect(workflow?.scripts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'build', invocation: 'pnpm build' }),
      expect.objectContaining({ name: 'test', invocation: 'pnpm test' }),
    ]));
    expect(workflow?.warnings).toContainEqual(expect.stringContaining('Skipped 4 middle ancestor directories'));
  });

  it.skipIf(process.platform === 'win32')('does not inspect package manifests symlinked outside the workspace', async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    const outsideManifest = path.join(outside, 'package.json');
    await writeJson(outsideManifest, { packageManager: 'npm@10.8.0', scripts: { test: 'outside' } });
    await symlink(outsideManifest, path.join(root, 'package.json'));

    await expect(new FileProjectWorkflowResolver().resolve({ environment: testEnvironment(root) })).resolves.toBeNull();
  });
});

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-project-workflow-'));
  temporaryDirectories.push(directory);
  return realpath(directory);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function testEnvironment(root: string, cwd = root): RuntimeEnvironment {
  return {
    id: 'project_1',
    cwd,
    workspaceRoot: root,
    workspaceRoots: [root],
  };
}
