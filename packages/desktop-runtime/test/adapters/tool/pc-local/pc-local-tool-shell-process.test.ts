import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyShellEnvironmentPatch } from '../../../../src/adapters/tool/pc-local/pc-local-tool-host.js';
import { classifyShellSessionFailure } from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-process.js';
import { createShellSandboxExecutionPlan } from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-policy.js';
import {
  createShellSessionTempDirectory,
  shellEnvironment,
} from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-session-runtime.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('classifyShellSessionFailure', () => {
  it.each([
    'Error: spawn EPERM',
    'Error: spawn /opt/toolchain/bin/esbuild EACCES',
    "code: 'EPERM',\nsyscall: 'spawn /bin/sh'",
    '/bin/sh: tool: Permission denied',
    'EROFS: read-only file system, open /protected/output.js',
  ])('classifies sandboxed permission output as sandbox_denied: %s', (stderr) => {
    expect(classifyShellSessionFailure(shellSession({ stderr }))).toMatchObject({
      failure_kind: 'sandbox_denied',
      failure_stage: 'execution',
    });
  });

  it.each(['EPERM', 'EACCES'])('classifies a sandboxed shell spawn error code as sandbox_denied: %s', (errorCode) => {
    expect(classifyShellSessionFailure(shellSession({ errorCode }))).toMatchObject({
      failure_kind: 'sandbox_denied',
      failure_stage: 'execution',
    });
  });

  it('keeps unrelated command failures and unsandboxed permission errors as process_exit', () => {
    expect(classifyShellSessionFailure(shellSession({ stderr: 'TypeScript found 2 errors.' }))).toMatchObject({
      failure_kind: 'process_exit',
    });
    expect(classifyShellSessionFailure(shellSession({ sandboxed: false, stderr: 'Error: spawn EPERM' }))).toMatchObject({
      failure_kind: 'process_exit',
    });
  });

  it('preserves a structured Windows sidecar error as sandbox diagnostics', () => {
    const failure = classifyShellSessionFailure(shellSession({
      sandboxProvider: 'windows-native',
      stdout: JSON.stringify({
        ok: false,
        error: {
          code: 'spawn-failed',
          message: 'CreateProcessWithLogonW failed: Access is denied. (os error 5)',
        },
      }),
    }));

    expect(failure).toMatchObject({
      failure_kind: 'sandbox_unavailable',
      failure_stage: 'preflight',
      sandbox_error_code: 'spawn-failed',
      sandbox_error_message: expect.stringContaining('os error 5'),
    });
  });
});

describe('applyShellEnvironmentPatch', () => {
  it('masks parent proxy variables when the resolved route is direct', () => {
    expect(applyShellEnvironmentPatch(
      { PATH: '/usr/bin', HTTP_PROXY: 'http://parent-proxy.example' },
      { HTTP_PROXY: null, HTTPS_PROXY: null },
    )).toEqual({
      PATH: '/usr/bin',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
    });
  });

  it('replaces Windows environment keys case-insensitively', () => {
    expect(applyShellEnvironmentPatch(
      {
        PATH: 'C:\\Windows\\System32',
        all_proxy: 'http://stale-proxy.example',
        no_proxy: 'localhost',
      },
      {
        ALL_PROXY: 'http://sandbox:secret@127.0.0.1:61080',
        NO_PROXY: '',
      },
      'win32',
    )).toEqual({
      PATH: 'C:\\Windows\\System32',
      ALL_PROXY: 'http://sandbox:secret@127.0.0.1:61080',
      NO_PROXY: '',
    });
  });
});

describe('shellEnvironment', () => {
  it('preserves the non-secret curl configuration directory for sandbox commands', () => {
    vi.stubEnv('CURL_HOME', 'C:\\Setsuna\\setsuna-path');

    expect(shellEnvironment().CURL_HOME).toBe('C:\\Setsuna\\setsuna-path');
  });

  it('does not apply native sandbox trust metadata to a generic shell environment', () => {
    vi.stubEnv('SETSUNA_DESKTOP_SANDBOX_CA_BUNDLE', 'C:\\Setsuna\\trust\\system.pem');
    vi.stubEnv('CURL_CA_BUNDLE', 'C:\\untrusted\\override.pem');

    expect(shellEnvironment({
      CURL_CA_BUNDLE: 'C:\\another\\override.pem',
    }).CURL_CA_BUNDLE).toBe('C:\\another\\override.pem');
  });
});

describe('createShellSessionTempDirectory', () => {
  it('gives Windows full-access commands an isolated directory under the OS temp root', async () => {
    const systemTempRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-system-temp-'));
    temporaryRoots.push(systemTempRoot);
    const plan = createShellSandboxExecutionPlan({
      root: systemTempRoot,
      osSandbox: true,
      permissionProfile: 'danger-full-access',
    });

    const commandTempRoot = await createShellSessionTempDirectory(plan, {
      platform: 'win32',
      tempRoot: systemTempRoot,
    });

    // Windows may expose one directory through both its 8.3 alias and long name.
    // Compare canonical identities instead of requiring a specific spelling.
    expect(await realpath(path.dirname(commandTempRoot))).toBe(await realpath(systemTempRoot));
    expect(path.basename(commandTempRoot)).toMatch(/^setsuna-shell-/u);
  });
});

function shellSession(overrides: Record<string, unknown> = {}) {
  return {
    aborted: false,
    cwd: '/workspace',
    environment: { PATH: '' },
    errorCode: '',
    exitCode: 1,
    sandboxed: true,
    signal: null,
    stderr: '',
    stdout: '',
    timedOut: false,
    toolchainCommands: {},
    ...overrides,
  };
}
