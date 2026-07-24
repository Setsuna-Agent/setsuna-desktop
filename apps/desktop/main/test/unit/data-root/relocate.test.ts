import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { desktopDataLayout } from '../../../src/data-root/layout.js';
import { relocateDataRootContents } from '../../../src/data-root/relocate.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('data root path relocation', () => {
  it('rewrites managed paths, removes legacy memory config and preserves valid hook trust', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-data-root-relocate-test-'));
    temporaryRoots.push(root);
    const sourceRoot = path.join(root, 'old data');
    const targetRoot = path.join(root, 'new data');
    const stagingRoot = path.join(root, 'staging');
    const stagingLayout = desktopDataLayout(stagingRoot);
    const oldConfigPath = desktopDataLayout(sourceRoot).runtimeConfigPath;
    const newConfigPath = desktopDataLayout(targetRoot).runtimeConfigPath;
    const oldCommand = `"${path.join(sourceRoot, 'runtime', 'hooks', 'run.sh')}"`;
    const newCommand = `"${path.join(targetRoot, 'runtime', 'hooks', 'run.sh')}"`;
    const oldHash = hookHash(oldCommand);
    await writeFixture(stagingLayout.runtimeConfigPath, JSON.stringify({
      schemaVersion: 2,
      storagePath: '/legacy-memory',
      providers: [],
      hooks: {
        PreToolUse: [{
          matcher: 'shell',
          hooks: [{
            type: 'command',
            command: oldCommand,
            timeoutSec: 600,
          }],
        }],
        state: {
          [`${oldConfigPath}:pre_tool_use:0:0`]: {
            enabled: true,
            trustedHash: oldHash,
          },
        },
      },
    }));
    await writeFixture(path.join(stagingLayout.runtimeRoot, 'plugins.json'), JSON.stringify({
      installPath: path.join(sourceRoot, 'runtime', 'plugins', 'demo'),
    }));
    await writeFixture(path.join(stagingLayout.runtimeRoot, 'mcp.json'), JSON.stringify({
      command: path.join(sourceRoot, 'runtime', 'plugins', 'demo', 'server.js'),
    }));
    await writeFixture(
      path.join(stagingLayout.runtimeRoot, 'workspace-dependencies', 'manifest.json'),
      JSON.stringify({ python: { path: path.join(sourceRoot, 'runtime', 'workspace-dependencies', 'toolchain', 'python') } }),
    );
    const shimPath = path.join(stagingLayout.runtimeRoot, 'workspace-dependencies', 'bin', 'python');
    await writeFixture(shimPath, `#!/bin/sh\nexec "${path.join(sourceRoot, 'runtime', 'workspace-dependencies', 'toolchain', 'python')}" "$@"\n`);
    const virtualEnvironmentConfig = path.join(
      stagingLayout.runtimeRoot,
      'temporary-workspace',
      '.venv',
      'pyvenv.cfg',
    );
    const virtualEnvironmentActivate = path.join(
      stagingLayout.runtimeRoot,
      'temporary-workspace',
      '.venv',
      'bin',
      'activate',
    );
    const managedPythonHome = path.join(
      sourceRoot,
      'runtime',
      'workspace-dependencies',
      'toolchain',
      'python',
      'bin',
    );
    await writeFixture(virtualEnvironmentConfig, `home = ${managedPythonHome}\n`);
    await writeFixture(
      virtualEnvironmentActivate,
      `VIRTUAL_ENV="${path.join(sourceRoot, 'runtime', 'temporary-workspace', '.venv')}"\n`,
    );
    const projectFixture = path.join(
      stagingLayout.runtimeRoot,
      'temporary-workspace',
      'project',
      'fixture.txt',
    );
    await writeFixture(projectFixture, `user content: ${sourceRoot}\n`);

    await relocateDataRootContents(stagingRoot, sourceRoot, targetRoot);

    const config = JSON.parse(await readFile(stagingLayout.runtimeConfigPath, 'utf8')) as {
      schemaVersion: number;
      storagePath?: string;
      hooks: {
        PreToolUse: Array<{ hooks: Array<{ command: string }> }>;
        state: Record<string, { trustedHash: string }>;
      };
    };
    expect(config.schemaVersion).toBe(3);
    expect(config.storagePath).toBeUndefined();
    expect(config.hooks.PreToolUse[0]?.hooks[0]?.command).toBe(newCommand);
    expect(config.hooks.state[`${newConfigPath}:pre_tool_use:0:0`]).toMatchObject({
      trustedHash: hookHash(newCommand),
    });
    for (const filePath of [
      path.join(stagingLayout.runtimeRoot, 'plugins.json'),
      path.join(stagingLayout.runtimeRoot, 'mcp.json'),
      path.join(stagingLayout.runtimeRoot, 'workspace-dependencies', 'manifest.json'),
      shimPath,
      virtualEnvironmentConfig,
      virtualEnvironmentActivate,
    ]) {
      const content = await readFile(filePath, 'utf8');
      expect(content).toContain(targetRoot);
      expect(content).not.toContain(sourceRoot);
    }
    await expect(readFile(projectFixture, 'utf8')).resolves.toContain(sourceRoot);
  });
});

async function writeFixture(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

function hookHash(command: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalJson({
    event_name: 'pre_tool_use',
    matcher: 'shell',
    hooks: [{
      type: 'command',
      command,
      timeout: 600,
      async: false,
    }],
  }))).digest('hex')}`;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])]),
  );
}
