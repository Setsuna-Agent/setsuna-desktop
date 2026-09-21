import { describe, expect, it } from 'vitest';
import type { Translate } from '../../../../src/shared/i18n/I18nProvider.js';
import { runtimeErrorDisplayMessage, unwrapRuntimeErrorMessage } from '../../../../src/services/runtime-client/runtimeErrorMessages.js';

const translateKey: Translate = (key) => key;

describe('runtime error display messages', () => {
  it.each([
    ['The model bound to this conversation is no longer available: deepseek-flash', 'runtimeError.modelUnavailable'],
    ['The selected model is no longer available.', 'runtimeError.modelUnavailable'],
    ['Workspace is unavailable: project_old', 'runtimeError.projectUnavailable'],
    ['Temporary workspace is unavailable.', 'runtimeError.temporaryWorkspaceUnavailable'],
    ['404 status code (no body)', 'runtimeError.modelEndpointNotFound'],
  ])('classifies current and persisted error %s', (error, expectedKey) => {
    expect(runtimeErrorDisplayMessage(error, translateKey)).toBe(expectedKey);
    const wrapped = new Error(`Error invoking remote method 'runtime:request': Error: ${error} (POST /v1/threads/thread_old/turns)`);
    expect(runtimeErrorDisplayMessage(wrapped, translateKey)).toBe(expectedKey);
  });

  it('keeps unknown diagnostic content while removing only transport wrappers', () => {
    const error = "Error invoking remote method 'runtime:request': Error: Model rejected an unsupported parameter: temperature (POST /v1/threads/thread_old/turns)";
    expect(unwrapRuntimeErrorMessage(error)).toBe('Model rejected an unsupported parameter: temperature');
    expect(runtimeErrorDisplayMessage(error, translateKey)).toBe('Model rejected an unsupported parameter: temperature');
    expect(runtimeErrorDisplayMessage('File content: 404 status code (no body)', translateKey)).toBe('File content: 404 status code (no body)');
  });
});
