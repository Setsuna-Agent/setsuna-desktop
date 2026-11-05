export { diagnosticsMainFeature, diagnosticsMainHostCapability } from './feature.js';
// The process creates this sink before Feature activation so early failures remain observable.
export { DesktopDiagnosticLog, DIAGNOSTIC_LOG_MAX_BYTES } from './diagnostic-log.js';
