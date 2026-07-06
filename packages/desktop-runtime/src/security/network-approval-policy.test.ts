import { describe, expect, it } from 'vitest';
import { assessShellNetworkAccess, networkApprovalContextFromTool } from './network-approval-policy.js';

describe('network approval policy', () => {
  it('extracts host-level context from obvious network shell commands', () => {
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
});
