import type { Translate } from '../../shared/i18n/I18nProvider.js';
import { runtimeClientErrorMessage } from './runtimeClientErrors.js';

/** IPC adds transport details that do not belong in user-facing feedback. */
export function unwrapRuntimeErrorMessage(error: unknown): string {
  return runtimeClientErrorMessage(error).trim()
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/u, '')
    .replace(/^(?:Error|TypeError):\s*/u, '')
    .replace(/\s+\((?:GET|POST|PUT|PATCH|DELETE) \/v1\/[^\s()]+\)$/u, '')
    .trim();
}

/** Format at the display boundary so persisted errors remain available for diagnosis. */
export function runtimeErrorDisplayMessage(error: unknown, t: Translate): string {
  const message = unwrapRuntimeErrorMessage(error);
  if (/^(?:The model bound to this conversation|The selected model) is no longer available[.:]/u.test(message)) {
    return t('runtimeError.modelUnavailable');
  }
  if (/^Workspace is unavailable:/u.test(message)) {
    return t('runtimeError.projectUnavailable');
  }
  if (message === 'Temporary workspace is unavailable.') {
    return t('runtimeError.temporaryWorkspaceUnavailable');
  }
  if (/^404 status code(?: \(no body\))?$/iu.test(message)) {
    return t('runtimeError.modelEndpointNotFound');
  }
  return message;
}
