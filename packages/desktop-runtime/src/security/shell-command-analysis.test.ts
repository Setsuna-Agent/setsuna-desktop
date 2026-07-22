import { describe, expect, it } from 'vitest';
import { shellPolicyDecision } from '../adapters/tool/pc-local-tool-shell-policy.js';
import { analyzeShellCommandStructure, parseReusableShellCommand, reusableShellCommandWords } from './shell-command-analysis.js';

describe('shell command authorization analysis', () => {
  it('parses static simple commands for reusable approvals', () => {
    expect(reusableShellCommandWords('git status --short')).toEqual(['git', 'status', '--short']);
    expect(reusableShellCommandWords('git status "path with spaces"')).toEqual(['git', 'status', 'path with spaces']);
    expect(reusableShellCommandWords('printf "a\\q"')).toEqual(['printf', 'a\\q']);
  });

  it('fails closed for compound, redirected, expanded, and globbed commands', () => {
    for (const command of [
      'git status; touch owned',
      'git status && touch owned',
      'git status | sh',
      'git status > output.txt',
      'git status $(danger)',
      'git status "$TARGET"',
      'git status *.txt',
      'git status\n touch owned',
    ]) {
      expect(parseReusableShellCommand(command), command).toBeNull();
    }
  });

  it('keeps quoted URL operators inside one shell segment', () => {
    expect(analyzeShellCommandStructure('curl "https://example.com/a?x=1&y=2"')).toMatchObject({
      hasControlOperators: false,
      segments: ['curl "https://example.com/a?x=1&y=2"'],
    });
    expect(analyzeShellCommandStructure('curl https://one.example; curl https://two.example')).toMatchObject({
      hasControlOperators: true,
      segments: ['curl https://one.example', 'curl https://two.example'],
    });
  });

  it('does not let exact policy matching rewrite shell separators as spaces', () => {
    const state = {
      shellPolicyRules: [{
        action: 'allow',
        command: 'git status',
        label: 'git status',
      }],
    };

    expect(shellPolicyDecision('git status', state).action).toBe('allow');
    expect(shellPolicyDecision('git\nstatus', state).action).toBe('');
    expect(shellPolicyDecision('git  status', state).action).toBe('');
  });
});
