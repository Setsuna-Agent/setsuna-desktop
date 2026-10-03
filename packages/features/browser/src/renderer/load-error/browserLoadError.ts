export type BrowserLoadErrorReason = 'refused' | 'notFound' | 'timedOut' | 'offline' | 'certificate' | 'generic';

const errorReasons: Readonly<Record<string, BrowserLoadErrorReason>> = {
  ERR_CONNECTION_REFUSED: 'refused',
  ERR_NAME_NOT_RESOLVED: 'notFound',
  ERR_CONNECTION_TIMED_OUT: 'timedOut',
  ERR_TIMED_OUT: 'timedOut',
  ERR_INTERNET_DISCONNECTED: 'offline',
};

export function browserLoadErrorInfo(message: string, url: string): {
  code: string | null;
  host: string;
  reason: BrowserLoadErrorReason;
} {
  // Both did-fail-load and loadURL's Electron IPC rejection contain Chromium codes.
  // Keep the transport wrapper out of the page without losing the diagnostic code.
  const code = message.match(/\bERR_[A-Z0-9_]+\b/)?.[0] ?? null;
  const reason: BrowserLoadErrorReason = code?.startsWith('ERR_CERT_')
    ? 'certificate'
    : (code && errorReasons[code]) || 'generic';
  let host = '';
  try { host = new URL(url).hostname; } catch { /* Invalid addresses use the generic description. */ }
  return { code, host, reason: host ? reason : 'generic' };
}
