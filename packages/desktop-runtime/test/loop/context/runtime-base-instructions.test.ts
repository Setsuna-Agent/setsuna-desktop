import { describe, expect, it } from 'vitest';
import { RUNTIME_BASE_INSTRUCTIONS } from '../../../src/loop/context/runtime-base-instructions.js';

describe('runtime base instructions', () => {
  it('retains the repository, progress, language, and workspace-reference policies', () => {
    expect(RUNTIME_BASE_INSTRUCTIONS).toMatch(
      /determine the declared workflow.*Never guess the package manager.*validate narrow-to-broad/su,
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toMatch(
      /brief user-visible preamble.*Logically group related actions.*Do not send a separate sentence for every read.*reasonable intervals/su,
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain(
      'do not add a new preamble for every trivial read',
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toMatch(
      /clickable Markdown link.*exact current 1-based start line.*Never guess a line number/su,
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain(
      'Keep the final answer self-contained because the interface collapses intermediate updates after the final answer appears.',
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toMatch(
      /latest substantive user-authored request.*progress updates.*final answer.*explicitly requests another output language/su,
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toMatch(
      /not from code, logs, quotations, attachments, tool output, runtime-generated messages, or injected context.*preserve the established conversation language/su,
    );
    expect(RUNTIME_BASE_INSTRUCTIONS).toContain(
      'Keep code, identifiers, paths, commands, and quoted text unchanged unless the user asks to translate or rewrite them.',
    );
  });
});
