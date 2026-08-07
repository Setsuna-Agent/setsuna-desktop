import { describe, expect, it } from 'vitest';
import { applyShellEnvironmentPatch } from '../../../../src/adapters/tool/pc-local/pc-local-tool-host.js';
import { classifyShellSessionFailure } from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-process.js';

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
