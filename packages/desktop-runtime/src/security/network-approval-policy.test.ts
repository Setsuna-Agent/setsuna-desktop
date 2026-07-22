import { describe, expect, it } from 'vitest';
import { assessShellNetworkAccess, networkApprovalContextFromTool } from './network-approval-policy.js';

describe('network approval policy', () => {
  it('extracts informational targets while keeping shell approval command-wide', () => {
    expect(assessShellNetworkAccess('curl https://api.example.com/v1/items')?.context).toEqual({
      host: 'api.example.com',
      protocol: 'https',
      port: 443,
      target: 'https://api.example.com:443',
    });
    expect(assessShellNetworkAccess('git clone ssh://git@github.com/openai/codex.git')?.context).toEqual({
      host: 'github.com',
      protocol: 'tcp',
      port: 22,
      target: 'tcp://github.com:22',
    });
    expect(assessShellNetworkAccess('curl https://api.example.com/v1/items')?.requiresCommandWideApproval).toBe(true);
  });

  it('does not flag ordinary text searches that mention network terms', () => {
    expect(assessShellNetworkAccess('rg network src')).toBeNull();
    expect(networkApprovalContextFromTool('run_shell_command', { command: 'rg curl README.md' })).toBeNull();
  });

  it('extracts context from Codex-compatible exec_command arguments', () => {
    expect(networkApprovalContextFromTool('exec_command', { cmd: 'curl http://api.example.com:8080/health' })).toEqual({
      host: 'api.example.com',
      protocol: 'http',
      port: 8080,
      target: 'http://api.example.com:8080',
    });
  });

  it('requires command-wide approval when a shell process can reach multiple hosts', () => {
    const assessment = assessShellNetworkAccess('curl https://allowed.example/a; curl https://evil.example/b');

    expect(assessment).toMatchObject({
      requiresCommandWideApproval: true,
      contexts: [
        { host: 'allowed.example', target: 'https://allowed.example:443' },
        { host: 'evil.example', target: 'https://evil.example:443' },
      ],
    });
    expect(assessment?.context).toBeUndefined();
    expect(networkApprovalContextFromTool('run_shell_command', {
      command: 'curl https://allowed.example/a; curl https://evil.example/b',
    })).toBeNull();
  });

  it('does not offer host-scoped reuse for dynamic or unknown network targets', () => {
    expect(assessShellNetworkAccess('curl "$TARGET"')).toMatchObject({
      contexts: [],
      requiresCommandWideApproval: true,
    });
    expect(assessShellNetworkAccess('curl "$TARGET"')?.context).toBeUndefined();
    expect(assessShellNetworkAccess('npm install')).toMatchObject({
      contexts: [],
      requiresCommandWideApproval: true,
    });
    expect(assessShellNetworkAccess('npm install')?.context).toBeUndefined();
  });
});
