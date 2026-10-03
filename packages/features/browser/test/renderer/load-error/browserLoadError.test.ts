import { describe, expect, it } from 'vitest';
import { browserLoadErrorInfo } from '../../../src/renderer/load-error/browserLoadError.js';

describe('browser load errors', () => {
  it('extracts the same diagnostic from a guest event and an IPC-wrapped loadURL rejection', () => {
    const url = 'http://localhost:3000/settings';
    const rejection = `Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ERR_CONNECTION_REFUSED (-102) loading '${url}'`;
    const failure = { code: 'ERR_CONNECTION_REFUSED', host: 'localhost', reason: 'refused' };
    expect(browserLoadErrorInfo(rejection, url)).toEqual(failure);
    expect(browserLoadErrorInfo('ERR_CONNECTION_REFUSED', url)).toEqual(failure);
  });

  it.each([
    ['ERR_NAME_NOT_RESOLVED', 'notFound'],
    ['ERR_CONNECTION_TIMED_OUT', 'timedOut'],
    ['ERR_TIMED_OUT', 'timedOut'],
    ['ERR_INTERNET_DISCONNECTED', 'offline'],
    ['ERR_CERT_AUTHORITY_INVALID', 'certificate'],
    ['ERR_CONNECTION_RESET', 'generic'],
  ])('classifies %s without discarding its code', (code, reason) => {
    expect(browserLoadErrorInfo(code, 'https://example.com/path')).toEqual({ code, host: 'example.com', reason });
  });

  it('falls back without exposing an unknown transport error or failing to parse an invalid address', () => {
    expect(browserLoadErrorInfo('Guest is detached', 'bad address')).toEqual({ code: null, host: '', reason: 'generic' });
  });
});
