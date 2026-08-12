import type { RuntimeInterfaceLanguage, RuntimeMessage } from '@setsuna-desktop/contracts';

export function runtimeReviewPolicyMessage(
  turnId: string,
  createdAt: string,
  language: RuntimeInterfaceLanguage,
): RuntimeMessage {
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
      'Begin with a short plain-text summary without a heading.',
      'For each finding, use `[P0-P3] Short title — path:line` (or `path:start-end`), followed by a concise explanation of the failure condition and impact. Keep line ranges minimal and tied to the changed code. Include confidence when evidence is incomplete.',
      'Order findings by severity. If there are no actionable findings, say so briefly and list only concrete residual validation gaps.',
      language === 'zh-CN'
        ? 'Write every user-facing title, summary, and explanation in Simplified Chinese. Do not add headings such as “审查开始”, “审查结束”, or “发现的问题”.'
        : 'Write every user-facing title, summary, and explanation in English. Do not add headings such as “Review started”, “Review completed”, or “Findings”.',
    ].join('\n'),
  };
}

const REVIEW_READ_ONLY_TOOL_NAMES = new Set([
  'list_directory',
  'find_files',
  'search_text',
  'read_file',
  'read_skill',
  'git_status',
  'git_log',
  'git_show',
  'read_diff',
  'workspace_list_directory',
  'workspace_search_text',
  'workspace_read_file',
]);

export function isReviewReadOnlyTool(name: string): boolean {
  return REVIEW_READ_ONLY_TOOL_NAMES.has(name);
}
