/** Metadata-only diagnostics; process and Feature owners choose which events to report. */
export type DiagnosticFields = Readonly<Record<string, string | number | boolean | null>>;
export type DiagnosticReporter = (event: string, fields: DiagnosticFields) => void;
