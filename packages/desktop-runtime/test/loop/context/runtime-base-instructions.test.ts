import { describe, expect, it } from 'vitest';
import { RUNTIME_BASE_INSTRUCTIONS } from '../../../src/loop/context/runtime-base-instructions.js';

describe('runtime base instructions', () => {
  it('retains the repository, progress, and workspace-reference policies', () => {
    expect(RUNTIME_BASE_INSTRUCTIONS).toMatch(
      /determine the declared workflow.*Never guess the package manager.*validate narrow-to-broad/su,
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toMatch(
      /one brief user-visible update.*at least 60 seconds.*Never narrate individual tool calls/su,
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toMatch(
      /clickable Markdown link.*exact current 1-based start line.*Never guess a line number/su,
    );
  });
});
