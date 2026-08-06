export interface CodexReviewComment {
  body?: string;
  url: string;
}

export interface ClassifiedCodexFinding {
  priority: string;
  url: string;
}

export interface ClassifiedCodexReviewFindings {
  blocking: ClassifiedCodexFinding[];
  advisory: ClassifiedCodexFinding[];
}

export function classifyCodexReviewFindings(
  comments: CodexReviewComment[],
): ClassifiedCodexReviewFindings;
