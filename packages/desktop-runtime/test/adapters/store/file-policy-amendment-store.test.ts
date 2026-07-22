import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilePolicyAmendmentStore } from '../../../src/adapters/store/file-policy-amendment-store.js';

describe('file policy amendment store', () => {
  it('persists and de-duplicates policy amendments', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-policy-amendments-'));
    const store = new FilePolicyAmendmentStore(dataDir);

    await store.appendExecPolicyAmendment(['git', 'status']);
    await store.appendExecPolicyAmendment(['git', 'status']);
    await store.appendNetworkPolicyAmendment({ host: 'API.EXAMPLE.COM:443', action: 'allow' }, 'https');
    await store.appendNetworkPolicyAmendment({ host: 'api.example.com', action: 'deny' }, 'http');
    await store.appendNetworkPolicyAmendment({ host: '[2001:DB8::1]:443', action: 'allow' }, 'https');
    await store.appendNetworkPolicyAmendment({ host: 'ssh.example.com', action: 'allow' }, 'tcp');
    await store.appendNetworkPolicyAmendment({ host: '*.example.com', action: 'allow' }, 'https');
    await store.appendNetworkPolicyAmendment({ host: 'https://api.example.com', action: 'allow' }, 'https');

    await expect(readFile(path.join(dataDir, 'rules', 'default.rules'), 'utf8')).resolves.toBe([
      'prefix_rule(pattern=["git", "status"], decision="allow")',
      'network_rule(host="api.example.com", protocol="https", decision="allow", justification="Allow https access to api.example.com")',
      'network_rule(host="api.example.com", protocol="http", decision="deny", justification="Deny http access to api.example.com")',
      'network_rule(host="2001:db8::1", protocol="https", decision="allow", justification="Allow https access to 2001:db8::1")',
      '',
    ].join('\n'));

    const reloaded = new FilePolicyAmendmentStore(dataDir);
    await expect(reloaded.listPolicyAmendments()).resolves.toEqual({
      execPolicyAmendments: [['git', 'status']],
      networkPolicyAmendments: [
        { host: 'api.example.com', action: 'deny' },
        { host: '2001:db8::1', action: 'allow' },
      ],
    });
  });

  it('reads legacy JSON amendments alongside Codex rules files', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-policy-amendments-'));
    await writeFile(path.join(dataDir, 'policy-amendments.json'), JSON.stringify({
      execPolicyAmendments: [['git', 'status']],
      networkPolicyAmendments: [{ host: 'legacy.example.com', action: 'allow' }],
    }), 'utf8');
    const store = new FilePolicyAmendmentStore(dataDir);
    await store.appendExecPolicyAmendment(['pnpm', 'test']);

    await expect(store.listPolicyAmendments()).resolves.toEqual({
      execPolicyAmendments: [['git', 'status'], ['pnpm', 'test']],
      networkPolicyAmendments: [{ host: 'legacy.example.com', action: 'allow' }],
    });
  });

  it('serializes concurrent rule appends within the runtime process', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-policy-amendments-'));
    const first = new FilePolicyAmendmentStore(dataDir);
    const second = new FilePolicyAmendmentStore(dataDir);

    await Promise.all([
      first.appendExecPolicyAmendment(['git', 'status']),
      second.appendExecPolicyAmendment(['git', 'status']),
      first.appendExecPolicyAmendment(['pnpm', 'test']),
      second.appendNetworkPolicyAmendment({ host: 'api.example.com', action: 'allow' }, 'https'),
    ]);

    await expect(readFile(path.join(dataDir, 'rules', 'default.rules'), 'utf8')).resolves.toBe([
      'prefix_rule(pattern=["git", "status"], decision="allow")',
      'prefix_rule(pattern=["pnpm", "test"], decision="allow")',
      'network_rule(host="api.example.com", protocol="https", decision="allow", justification="Allow https access to api.example.com")',
      '',
    ].join('\n'));
  });

  it('waits for an active cross-process rules lock before appending', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-policy-amendments-'));
    const rulesPath = path.join(dataDir, 'rules', 'default.rules');
    const lockDir = `${rulesPath}.lock`;
    await mkdir(lockDir, { recursive: true });
    const store = new FilePolicyAmendmentStore(dataDir);

    const append = store.appendExecPolicyAmendment(['git', 'status']);
    await rm(lockDir, { recursive: true, force: true });
    await append;

    await expect(readFile(rulesPath, 'utf8')).resolves.toBe([
      'prefix_rule(pattern=["git", "status"], decision="allow")',
      '',
    ].join('\n'));
  });

  it('removes stale cross-process rules locks before appending', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-policy-amendments-'));
    const rulesPath = path.join(dataDir, 'rules', 'default.rules');
    const lockDir = `${rulesPath}.lock`;
    await mkdir(lockDir, { recursive: true });
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockDir, staleTime, staleTime);
    const store = new FilePolicyAmendmentStore(dataDir);

    await store.appendExecPolicyAmendment(['pnpm', 'test']);

    await expect(readFile(rulesPath, 'utf8')).resolves.toBe([
      'prefix_rule(pattern=["pnpm", "test"], decision="allow")',
      '',
    ].join('\n'));
  });
});
