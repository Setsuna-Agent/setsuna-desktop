import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type {
  FeatureCredentialBackup,
  PortableFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { RuntimeHttpError } from './http-error.js';
import { readBody, sendJson } from './http-utils.js';
import type { InFlightRequestTracker } from './in-flight-requests.js';
import type { RuntimeFactory } from './types.js';

const DATA_MIGRATION_PREPARE_PATH = '/v1/data-migration/prepare';
const WEBDAV_SYNC_PREPARE_PATH = '/internal/webdav-sync/prepare';
const WEBDAV_SYNC_FEATURE_SETTINGS_PATH = '/internal/webdav-sync/feature-settings';
const WEBDAV_SYNC_FEATURE_SETTINGS_RESTORE_PATH = '/internal/webdav-sync/feature-settings/restore-stage';
const WEBDAV_SYNC_FEATURE_CREDENTIALS_PATH = '/internal/webdav-sync/feature-credentials';

/**
 * Closes the runtime's HTTP admission boundary while a consistent on-disk snapshot is staged.
 * AgentLoop owns turn admission; this gate covers every other store mutation exposed by REST.
 */
export class RuntimeMaintenanceGate {
  private preparing = false;

  constructor(
    private readonly runtime: RuntimeFactory,
    private readonly requests: InFlightRequestTracker,
  ) {}

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname === WEBDAV_SYNC_FEATURE_SETTINGS_PATH) {
      if (request.method !== 'GET') return false;
      sendJson(response, 200, {
        documents: await this.runtime.featureSettings.exportPortableDocuments(),
      });
      return true;
    }
    if (url.pathname === WEBDAV_SYNC_FEATURE_CREDENTIALS_PATH) {
      if (request.method !== 'GET') return false;
      sendJson(response, 200, {
        credentials: await this.runtime.featureSettings.exportCredentialBackups(),
      });
      return true;
    }
    if (url.pathname === WEBDAV_SYNC_FEATURE_SETTINGS_RESTORE_PATH) {
      if (request.method !== 'POST') return false;
      if (!this.preparing) {
        throw new RuntimeHttpError(
          409,
          'Portable Feature settings restore requires the WebDAV preparation gate.',
          'webdav_sync_not_preparing',
        );
      }
      const body = await readBody<{
        documents?: unknown;
        credentials?: unknown;
        stagingRoot?: unknown;
      }>(request);
      if (
        !Array.isArray(body.documents)
        || !Array.isArray(body.credentials)
        || typeof body.stagingRoot !== 'string'
        || !body.stagingRoot
      ) {
        throw new RuntimeHttpError(
          400,
          'Portable Feature settings restore payload is invalid.',
          'invalid_webdav_feature_settings_restore',
        );
      }
      const targets = await this.runtime.featureSettings.stagePortableDocumentsRestore({
        documents: body.documents as PortableFeatureSettingsDocument[],
        credentials: body.credentials as FeatureCredentialBackup[],
        stagingRoot: body.stagingRoot,
      });
      sendJson(response, 200, { targets });
      return true;
    }
    if (!isPreparePath(url.pathname)) return false;

    if (request.method === 'DELETE') {
      this.release();
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (request.method !== 'POST') return false;

    // The current prepare request is already tracked. Any other admitted handler may still
    // perform a durable write, so it participates in the same atomic readiness decision.
    const readiness = this.runtime.agentLoop.prepareDataMigration(
      Math.max(0, this.requests.count - 1),
    );
    if (!readiness.ready) {
      sendJson(response, 200, readiness);
      return true;
    }

    // No await is allowed between AgentLoop admission closing and this assignment. That keeps
    // new REST requests from slipping into the snapshot window on the JavaScript event loop.
    this.preparing = true;
    try {
      if (url.pathname === WEBDAV_SYNC_PREPARE_PATH) {
        await this.runtime.threadStore.flush();
      }
      sendJson(response, 200, readiness);
      return true;
    } catch (error) {
      this.release();
      throw error;
    }
  }

  assertAcceptingRequests(): void {
    if (!this.preparing) return;
    throw new RuntimeHttpError(
      409,
      'Desktop runtime is preparing a consistent data snapshot and cannot accept requests.',
      'data_migration_preparing',
    );
  }

  private release(): void {
    this.runtime.agentLoop.cancelDataMigrationPreparation();
    this.preparing = false;
  }
}

function isPreparePath(pathname: string): boolean {
  return pathname === DATA_MIGRATION_PREPARE_PATH || pathname === WEBDAV_SYNC_PREPARE_PATH;
}
