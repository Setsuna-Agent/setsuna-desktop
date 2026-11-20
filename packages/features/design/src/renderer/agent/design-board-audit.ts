import { designLayerPath, designLayoutReport, type DesignReportView } from './design-layout-report.js';
import { groupDesignClipping } from './design-clipping-groups.js';

const priority = { clipped: 0, occludedText: 0, lowContrast: 0, textOverflow: 0, fillInHug: 1, unverifiedClipping: 1, unverifiedContrast: 1,
  outsideParent: 2, possibleOverlap: 2, expectedOverlap: 2 };

export function auditDesignBoard(view: DesignReportView, roots: readonly string[], revision: string, checks?: unknown, includeExpected = false) {
  const { findings, checked, unverifiedContrast } = designLayoutReport(view, roots, revision, 0, includeExpected, checks, Infinity);
  const rootIds = new Set(roots);
  const clipped = new Map<string, Extract<(typeof findings)[number], { kind: 'outOfBounds' }> | undefined>();
  const otherIssues = [...findings, ...unverifiedContrast.map((id) => ({ kind: 'unverifiedContrast' as const, id }))].flatMap((issue) => {
    if (issue.kind === 'outOfBounds' && issue.visibility === 'clipped') {
      clipped.set(issue.id, issue);
      return [];
    }
    if (issue.kind === 'textOverflow' && issue.reason === 'clipped') {
      if (!clipped.has(issue.id)) clipped.set(issue.id, undefined);
      return [];
    }
    const kind = issue.kind === 'outOfBounds' ? issue.visibility : issue.kind;
    const path = issue.kind === 'outOfBounds' ? issue.path : designLayerPath(view, rootIds, issue.id);
    return [{ ...issue, kind, path, clipperId: undefined, affectedCount: undefined }];
  });
  const issues = [...groupDesignClipping(view, rootIds, clipped.keys()).map((group) => ({
    ...(group.affectedCount === 1 ? clipped.get(group.id) : undefined),
    kind: 'clipped' as const, ...group, path: designLayerPath(view, rootIds, group.id),
  })), ...otherIssues];
  issues.sort((a, b) => priority[a.kind] - priority[b.kind]);
  const summary: Record<string, number> = {};
  for (const { kind } of issues) summary[kind] = (summary[kind] ?? 0) + 1;
  return { revision, checked, issueCount: issues.length, summary, issues };
}

// The transport caps a tool reply. Page only issue details; totals always cover the whole board.
export function designAuditPage(report: ReturnType<typeof auditDesignBoard>, offset: number, budget = 140_000) {
  const issues = [];
  let length = 0;
  for (let i = offset; i < report.issues.length; i++) {
    const row = report.issues[i];
    length += JSON.stringify(row).length + 1;
    if (issues.length && length > budget) break;
    issues.push(row);
  }
  const next = offset + issues.length;
  return { ...report, issues, ...(next < report.issueCount ? { nextOffset: next } : {}) };
}
