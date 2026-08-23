import type { FeatureId } from '@setsuna-desktop/feature-core/definition';
import {
  FeatureSettingsDocumentError,
  FeatureSettingsRevisionConflictError,
} from '@setsuna-desktop/feature-core/settings';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { RuntimeHttpError } from './http-error.js';
import { readBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export async function handleRuntimeFeatureManagementRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/feature-management/status') {
    sendJson(response, 200, {
      features: runtime.featureManagement.statuses(),
      settings: runtime.featureSettings.listRegisteredDocuments(),
    });
    return true;
  }

  const match = url.pathname.match(
    /^\/v1\/feature-management\/([^/]+)\/settings\/([^/]+)(?:\/(diagnosis|reset))?$/u,
  );
  if (!match) return false;
  const featureId = registeredFeatureId(runtime, decodeURIComponent(match[1]));
  const documentId = decodeURIComponent(match[2]);
  if (!runtime.featureSettings.listRegisteredDocuments().some((document) => (
    document.featureId === featureId && document.documentId === documentId
  ))) throw new RuntimeHttpError(404, 'Feature settings document is not registered.');

  if (match[3] === undefined && request.method === 'GET') {
    try {
      sendJson(response, 200, await runtime.featureSettings.readPublicDocument(featureId, documentId));
    } catch (error) {
      throw settingsManagementError(error);
    }
    return true;
  }
  if (match[3] === undefined && request.method === 'PATCH') {
    const input = await readBody<Readonly<{
      expectedRevision?: unknown;
      patch?: unknown;
      secretPatch?: unknown;
    }> | null>(request, null);
    if (!input || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
      throw new RuntimeHttpError(400, 'Settings update requires a non-negative expectedRevision.');
    }
    try {
      sendJson(response, 200, await runtime.featureSettings.updatePublicDocument({
        featureId,
        documentId,
        expectedRevision: input.expectedRevision as number,
        patch: input.patch ?? {},
        ...(input.secretPatch === undefined ? {} : { secretPatch: input.secretPatch }),
      }));
    } catch (error) {
      throw settingsManagementError(error);
    }
    return true;
  }
  if (match[3] === 'diagnosis' && request.method === 'GET') {
    sendJson(response, 200, await runtime.featureSettings.diagnoseDocument(featureId, documentId));
    return true;
  }
  if (match[3] === 'reset' && request.method === 'POST') {
    const input = await readBody<Readonly<{
      expectedDiagnosisId?: unknown;
      confirmed?: unknown;
    }> | null>(request, null);
    if (!input || typeof input.expectedDiagnosisId !== 'string' || input.confirmed !== true) {
      throw new RuntimeHttpError(400, 'Reset requires expectedDiagnosisId and confirmed: true.');
    }
    sendJson(response, 200, await runtime.featureSettings.resetDocument({
      featureId,
      documentId,
      expectedDiagnosisId: input.expectedDiagnosisId,
      confirmed: true,
    }));
    return true;
  }
  return false;
}

function settingsManagementError(error: unknown): Error {
  if (error instanceof FeatureSettingsRevisionConflictError) {
    return new RuntimeHttpError(
      409,
      error.message,
      'feature_settings_revision_conflict',
    );
  }
  if (error instanceof FeatureSettingsDocumentError) {
    return new RuntimeHttpError(
      409,
      'Feature settings document requires recovery.',
      `feature_settings_${error.status.replaceAll('-', '_')}`,
    );
  }
  return error instanceof Error ? error : new Error('Feature settings operation failed.');
}

function registeredFeatureId(runtime: RuntimeFactory, value: string): FeatureId {
  if (!FEATURE_ID_PATTERN.test(value)) throw new RuntimeHttpError(400, 'FeatureId is invalid.');
  const featureId = value as FeatureId;
  if (!runtime.featureSettings.listRegisteredDocuments().some((document) => document.featureId === featureId)) {
    throw new RuntimeHttpError(404, 'Feature is not registered.');
  }
  return featureId;
}
