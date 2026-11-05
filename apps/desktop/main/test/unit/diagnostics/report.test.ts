import { expect, it } from 'vitest';
import { diagnosticErrorFields } from '../../../src/diagnostics/report.js';

it('retains error classification and call sites without copying a sensitive multiline message', () => {
  const error = Object.assign(new Error('Bearer private-token\n    at sensitive-payload:1:1'), { code: 'EACCES' });
  const details = diagnosticErrorFields(error);
  expect(details).toMatchObject({ errorName: 'Error', errorCode: 'EACCES' });
  expect(details.errorStack).toContain('report.test.ts');
  expect(JSON.stringify(details)).not.toContain('private-token');
  expect(JSON.stringify(details)).not.toContain('sensitive-payload');
});

it('does not serialize arbitrary rejection values or custom stacks containing message content', () => {
  expect(diagnosticErrorFields({ token: 'secret', message: 'private request' })).toEqual({
    errorName: 'UnknownError', errorCode: null, errorStack: null,
  });
  const error = new Error('private response');
  error.stack = 'private custom diagnostic';
  expect(diagnosticErrorFields(error).errorStack).toBeNull();
});
