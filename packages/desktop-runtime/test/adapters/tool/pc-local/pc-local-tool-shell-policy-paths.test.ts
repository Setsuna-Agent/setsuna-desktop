import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadShellPolicyRules } from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-policy.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
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
