import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { RuntimeHttpError } from './http-error.js';
import { sendJson } from './http-utils.js';
import type { InFlightRequestTracker } from './in-flight-requests.js';
import type { RuntimeFactory } from './types.js';

const DATA_MIGRATION_PREPARE_PATH = '/v1/data-migration/prepare';

/**
 * Closes the runtime's HTTP admission boundary while its data directory is migrated.
 * AgentLoop owns turn admission; this gate covers every other store mutation exposed by REST.
 */
export class RuntimeMaintenanceGate {
  private preparing = false;

  constructor(
    private readonly runtime: RuntimeFactory,
    private readonly requests: InFlightRequestTracker,
  ) {}

  handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): boolean {
    if (url.pathname !== DATA_MIGRATION_PREPARE_PATH) return false;

    if (request.method === 'DELETE') {
      this.release();
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (request.method !== 'POST') return false;

    // The current prepare request is already tracked. Both admitted handlers and scheduler
    // mutations can still write, so neither may be overtaken by the readiness decision.
    const readiness = this.runtime.agentLoop.prepareDataMigration(
      Math.max(0, this.requests.count - 1) + this.runtime.automationToolHost.pendingMutationCount(),
    );
    if (!readiness.ready) {
      sendJson(response, 200, readiness);
      return true;
    }

    // No await is allowed between AgentLoop admission closing and this assignment. That keeps
    // new REST requests from slipping into the migration window on the JavaScript event loop.
    this.preparing = true;
    this.runtime.automationToolHost.setMaintenancePaused(true);
    sendJson(response, 200, readiness);
    return true;
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
    this.runtime.automationToolHost.setMaintenancePaused(false);
  }
}
