import { describe, expect, it } from 'vitest';
import { RUNTIME_BASE_INSTRUCTIONS } from '../../../src/loop/context/runtime-base-instructions.js';

describe('RUNTIME_BASE_INSTRUCTIONS', () => {
  it('requires repository workflow discovery before mutation or validation', () => {
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('determine the declared workflow before modifying or validating');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('Never guess the package manager');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('preserve their flags for narrower checks');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('validate narrow-to-broad');
  });

  it('keeps progress updates sparse instead of narrating tool calls', () => {
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('one brief user-visible update');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('work silently until the final answer');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('at least 60 seconds have passed');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('Never narrate individual tool calls');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('is not by itself a reason to send an update');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('interface collapses intermediate updates');
  });

  it('requires precise line-linked workspace references in final answers', () => {
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('selective and actionable');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('clickable Markdown link');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('exact current 1-based start line');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('post-edit workspace state');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('one batched read-only lookup');
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain('Never guess a line number or cite a line range');
  });
});
