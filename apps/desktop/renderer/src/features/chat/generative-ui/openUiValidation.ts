import type { ParseResult } from '@openuidev/react-lang';

export const maxOpenUiCharacters = 100_000;

export function isCompleteOpenUiPresentation(result: ParseResult): boolean {
  return Boolean(result.root || result.rootExpression)
    && !result.meta.incomplete && result.meta.unresolved.length === 0
    && !result.meta.errors.some((error) => error.severity !== 'warning')
    && result.queryStatements.length === 0 && result.mutationStatements.length === 0;
}
