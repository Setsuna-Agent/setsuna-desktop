import type { RuntimeMessage } from '@setsuna-desktop/contracts';

export function runtimeReviewPolicyMessage(turnId: string, createdAt: string): RuntimeMessage {
  return {
    id: 'desktop_review_policy',
    turnId,
    role: 'developer',
    promptSource: 'review',
    visibility: 'model',
    status: 'complete',
    createdAt,
    content: [
      'Review mode is active. Inspect and report findings only; do not modify files or implement fixes.',
      'Report only discrete, actionable defects introduced by the reviewed change: correctness bugs, regressions, security issues, or a specific missing test that leaves changed behavior unverified.',
      'Do not report style preferences, broad refactors, speculative risks, or pre-existing problems.',
      'For each finding, use `[P0-P3] Short title — path:line`, followed by a concise explanation of the failure condition and impact. Keep line ranges minimal and tied to the changed code. Include confidence when evidence is incomplete.',
      'Order findings by severity. If there are no actionable findings, say so briefly and list only concrete residual validation gaps.',
    ].join('\n'),
  };
}

const REVIEW_READ_ONLY_TOOL_NAMES = new Set([
  'list_directory',
  'find_files',
  'search_text',
  'read_file',
  'git_status',
  'read_diff',
  'workspace_list_directory',
  'workspace_search_text',
  'workspace_read_file',
]);

export function isReviewReadOnlyTool(name: string): boolean {
  return REVIEW_READ_ONLY_TOOL_NAMES.has(name);
}
