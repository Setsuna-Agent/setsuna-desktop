import type { DiagnosticFields, DiagnosticReporter } from '@setsuna-desktop/contracts';

/** Observability must never change recovery, cancellation or startup behavior. */
export function reportDiagnostic(reporter: DiagnosticReporter | undefined, event: string, fields: DiagnosticFields): void {
  try { reporter?.(event, fields); }
  catch { console.warn('[desktop-diagnostics] diagnostic reporter failed'); }
}

/** Error messages can contain provider responses or credentials; retain classification and call sites only. */
export function diagnosticErrorFields(error: unknown): DiagnosticFields {
  if (!(error instanceof Error)) return { errorName: 'UnknownError', errorCode: null, errorStack: null };
  const prefix = `${error.name}${error.message ? `: ${error.message}` : ''}`;
  const stack = error.stack?.startsWith(prefix) ? error.stack.slice(prefix.length) : '';
  const code = 'code' in error ? error.code : null;
  return {
    errorName: error.name.slice(0, 80),
    errorCode: typeof code === 'string' ? code.slice(0, 80) : typeof code === 'number' ? code : null,
    errorStack: stack?.split('\n').filter((line) => /^\s+at /u.test(line)).slice(0, 8).join('\n').slice(0, 4_000) || null,
  };
}
