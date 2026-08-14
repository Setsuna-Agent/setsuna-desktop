import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createShellSandboxExecutionPlan,
  loadShellPolicyRules,
} from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-policy.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('PC local global policy paths', () => {
  it('loads only the data-root policy paths supplied by the runtime', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-policy-path-test-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const unifiedPolicy = path.join(root, 'runtime', 'pc-local-policies', 'legacy-exec-policy.json');
    const externalPolicy = path.join(root, '.setsuna', 'desktop', 'exec-policy.json');
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(path.dirname(unifiedPolicy), { recursive: true }),
      mkdir(path.dirname(externalPolicy), { recursive: true }),
    ]);
    await writeFile(unifiedPolicy, JSON.stringify({
      rules: [{ action: 'allow', prefix: ['from-unified-root'] }],
    }), 'utf8');
    await writeFile(externalPolicy, JSON.stringify({
      rules: [{ action: 'deny', prefix: ['from-external-root'] }],
    }), 'utf8');

    const rules = loadShellPolicyRules(workspace, [unifiedPolicy]);

    expect(rules).toEqual([
      expect.objectContaining({
        action: 'allow',
        label: 'from-unified-root',
        sourcePath: unifiedPolicy,
      }),
    ]);
  });
});

describe('Windows sandbox curl environment', () => {
  it('uses the bundled curl only for a Windows-native execution plan', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-trust-path-test-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const curlDirectory = path.join(root, 'setsuna-path');
    const curlExecutable = path.join(curlDirectory, 'curl.exe');
    const curlConfig = path.join(curlDirectory, '_curlrc');
    const trustBundle = path.join(root, 'runtime', 'sandbox-trust', 'curl-ca-bundle.pem');
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(curlDirectory, { recursive: true }),
      mkdir(path.dirname(trustBundle), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(curlExecutable, 'curl', 'utf8'),
      writeFile(curlConfig, 'ca-native', 'utf8'),
      writeFile(trustBundle, 'public CA material', 'utf8'),
    ]);
    vi.stubEnv('SETSUNA_DESKTOP_SANDBOX_CURL_PATH', curlExecutable);
    vi.stubEnv('SETSUNA_DESKTOP_SANDBOX_CA_BUNDLE', trustBundle);

    const plan = createShellSandboxExecutionPlan({
      root: workspace,
      osSandbox: true,
      permissionProfile: 'read-only',
    }, {
      capability: {
        executablePath: path.join(root, 'setsuna-sandbox-win.exe'),
        provider: 'windows-native',
        reason: '',
        supported: true,
      },
      environment: { PATH: path.join(root, 'system-bin') },
    });

    expect(plan.environment.PATH?.split(path.delimiter)[0]).toBe(curlDirectory);
    expect(plan.environment.CURL_HOME).toBe(curlDirectory);
    expect(plan.environment.CURL_CA_BUNDLE).toBe(trustBundle);
    expect(plan.readableRoots).toContain(path.resolve(curlExecutable));
    expect(plan.readableRoots).toContain(path.resolve(curlConfig));
    expect(plan.readableRoots).toContain(path.resolve(trustBundle));
    expect(plan.readableRoots).not.toContain(path.dirname(trustBundle));

    const bypass = createShellSandboxExecutionPlan({
      root: workspace,
      osSandbox: true,
      permissionProfile: 'danger-full-access',
    }, {
      environment: { PATH: path.join(root, 'system-bin') },
    });
    expect(bypass.provider).toBe('bypass');
    expect(bypass.environment).toEqual({ PATH: path.join(root, 'system-bin') });
    expect(bypass.readableRoots).not.toContain(path.resolve(curlExecutable));
    expect(bypass.readableRoots).not.toContain(path.resolve(trustBundle));
  });

  it('keeps direct-tool attachment roots out of Windows shell plans', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-direct-tool-shell-plan-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const configuredRoot = path.join(root, 'configured-readable');
    const attachment = path.join(root, 'private-attachment.txt');
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(configuredRoot, { recursive: true }),
      writeFile(attachment, 'private', 'utf8'),
    ]);

    const plan = createShellSandboxExecutionPlan({
      root: workspace,
      osSandbox: true,
      permissionProfile: 'workspace-write',
      directToolReadableRoots: [attachment],
      sandboxWorkspaceWrite: { readableRoots: [configuredRoot] },
    }, {
      capability: {
        executablePath: path.join(root, 'setsuna-sandbox-win.exe'),
        provider: 'windows-native',
        reason: '',
        supported: true,
      },
    });

    expect(plan.readableRoots).toContain(path.resolve(configuredRoot));
    expect(plan.readableRoots).not.toContain(path.resolve(attachment));
  });
});
