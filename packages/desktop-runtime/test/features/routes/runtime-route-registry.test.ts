import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import {
  defineFeatureOperation,
  FeatureOperationFailure,
} from '@setsuna-desktop/feature-core/operation';
import { createFeatureScope, type FeatureScopeController } from '@setsuna-desktop/feature-core/scope';
import { FeatureOperationCancelledError } from '@setsuna-desktop/feature-core/status';
import { createServer, request as sendHttpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeRouteRegistry } from '../../../src/features/routes/runtime-route-registry.js';

const objectCodec = defineRuntimeCodec((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
  return value as Record<string, unknown>;
});
const emptyOrObjectCodec = defineRuntimeCodec((value) => {
  if (value === undefined) return {};
  return objectCodec.parse(value);
});

describe('RuntimeRouteRegistry', () => {
  let server: Server | null = null;
  let scope: FeatureScopeController | null = null;

  afterEach(async () => {
    await scope?.finishDispose().catch(() => undefined);
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    scope = null;
    server = null;
  });

  it('uses one descriptor for codec validation and route parameters', async () => {
    const registry = new RuntimeRouteRegistry();
    scope = featureScope();
    const operation = defineFeatureOperation({
      id: 'fixture.items.read',
      method: 'GET',
      path: '/v1/features/fixture/items/:itemId',
      input: objectCodec,
      output: objectCodec,
      errors: {},
      idempotency: 'safe',
    });
    registry.register(scope.scope, operation, async (input, { signal }) => ({
      itemId: input.itemId,
      query: input.query,
      aborted: signal.aborted,
    }));
    scope.activate();
    const baseUrl = await listen(registry);

    const response = await fetch(`${baseUrl}/v1/features/fixture/items/a%20b?query=value`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      itemId: 'a b',
      query: 'value',
      aborted: false,
    });
  });

  it('maps input codec failures to a safe invalid-input response', async () => {
    const registry = new RuntimeRouteRegistry();
    scope = featureScope();
    const input = defineRuntimeCodec((value) => {
      if (!value || typeof value !== 'object' || typeof (value as { name?: unknown }).name !== 'string') {
        throw new Error('unsafe codec detail');
      }
      return value as { name: string };
    });
    const operation = defineFeatureOperation({
      id: 'fixture.items.create',
      method: 'POST',
      path: '/v1/features/fixture/items',
      input,
      output: objectCodec,
      errors: {},
      idempotency: 'non-idempotent',
    });
    registry.register(scope.scope, operation, ({ name }) => ({ name }));
    scope.activate();
    const baseUrl = await listen(registry);

    const response = await fetch(`${baseUrl}/v1/features/fixture/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Feature operation input is invalid.',
      code: 'INVALID_INPUT',
      retryable: false,
    });
  });

  it('prefers literal routes and rejects parameter patterns with the same shape', async () => {
    const registry = new RuntimeRouteRegistry();
    scope = featureScope();
    const parameterOperation = operation('fixture.items.parameter', '/v1/features/fixture/items/:itemId');
    const literalOperation = operation('fixture.items.literal', '/v1/features/fixture/items/static');
    registry.register(scope.scope, parameterOperation, () => ({ selected: 'parameter' }));
    registry.register(scope.scope, literalOperation, () => ({ selected: 'literal' }));
    expect(() => registry.register(
      scope?.scope ?? featureScope().scope,
      operation('fixture.items.conflict', '/v1/features/fixture/items/:name'),
      () => ({ selected: 'conflict' }),
    )).toThrow(/route conflict/iu);
    scope.activate();
    const baseUrl = await listen(registry);

    const response = await fetch(`${baseUrl}/v1/features/fixture/items/static`);
    await expect(response.json()).resolves.toEqual({ selected: 'literal' });
  });

  it('maps declared business failures and rejects invalid details fail closed', async () => {
    const registry = new RuntimeRouteRegistry();
    scope = featureScope();
    const detailsCodec = defineRuntimeCodec((value) => {
      if (!value || typeof value !== 'object' || typeof (value as { current?: unknown }).current !== 'number') {
        throw new Error('current revision required');
      }
      return value as { current: number };
    });
    const conflict = defineFeatureOperation({
      id: 'fixture.settings.update',
      method: 'PUT',
      path: '/v1/features/fixture/settings',
      input: objectCodec,
      output: objectCodec,
      errors: { CONFLICT: { status: 409, details: detailsCodec } },
      idempotency: 'idempotent',
    });
    registry.register(scope.scope, conflict, () => {
      throw new FeatureOperationFailure({
        code: 'CONFLICT',
        message: 'revision changed',
        retryable: true,
        details: { current: 4 },
      });
    });
    const invalidDetails = defineFeatureOperation({
      ...conflict,
      id: 'fixture.settings.invalid-details',
      path: '/v1/features/fixture/invalid-details',
    });
    registry.register(scope.scope, invalidDetails, () => {
      throw new FeatureOperationFailure({
        code: 'CONFLICT',
        message: 'must not leak',
        retryable: false,
        details: { current: 'secret-like-invalid-value' },
      });
    });
    scope.activate();
    const baseUrl = await listen(registry);

    const response = await fetch(`${baseUrl}/v1/features/fixture/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'revision changed',
      code: 'CONFLICT',
      retryable: true,
      details: { current: 4 },
    });

    const invalidResponse = await fetch(`${baseUrl}/v1/features/fixture/invalid-details`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(invalidResponse.status).toBe(500);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: 'Feature operation failed.',
      code: 'INTERNAL',
      retryable: false,
    });
  });

  it('cancels an operation when the client closes the response after its body was read', async () => {
    const registry = new RuntimeRouteRegistry();
    scope = featureScope();
    const create = defineFeatureOperation({
      id: 'fixture.tasks.create',
      method: 'POST',
      path: '/v1/features/fixture/tasks',
      input: objectCodec,
      output: objectCodec,
      errors: {},
      idempotency: 'non-idempotent',
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let markAborted: ((reason: unknown) => void) | undefined;
    const aborted = new Promise<unknown>((resolve) => { markAborted = resolve; });
    registry.register(scope.scope, create, (_input, { signal }) => new Promise((_, reject) => {
      markStarted?.();
      signal.addEventListener('abort', () => {
        markAborted?.(signal.reason);
        reject(signal.reason);
      }, { once: true });
    }));
    scope.activate();
    const baseUrl = await listen(registry);
    const clientRequest = sendHttpRequest(`${baseUrl}/v1/features/fixture/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    clientRequest.on('error', () => undefined);
    clientRequest.end('{}');

    await started;
    clientRequest.destroy();

    await expect(aborted).resolves.toBeInstanceOf(FeatureOperationCancelledError);
  });

  it('unregisters routes with their owner scope', async () => {
    const registry = new RuntimeRouteRegistry();
    scope = featureScope();
    registry.register(
      scope.scope,
      operation('fixture.lifecycle.read', '/v1/features/fixture/lifecycle'),
      () => ({ selected: 'active' }),
    );
    scope.activate();
    const baseUrl = await listen(registry);
    expect((await fetch(`${baseUrl}/v1/features/fixture/lifecycle`)).status).toBe(200);

    await scope.finishDispose();
    expect((await fetch(`${baseUrl}/v1/features/fixture/lifecycle`)).status).toBe(404);
  });

  function listen(registry: RuntimeRouteRegistry): Promise<string> {
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (!await registry.handle(request, response, url)) {
        response.writeHead(404).end();
      }
    });
    return new Promise((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('fixture server address unavailable');
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }
});

function operation(id: string, path: string) {
  return defineFeatureOperation({
    id,
    method: 'GET',
    path,
    input: emptyOrObjectCodec,
    output: objectCodec,
    errors: {},
    idempotency: 'safe',
  });
}

function featureScope(): FeatureScopeController {
  return createFeatureScope({
    featureId: defineFeatureDefinition({ id: 'fixture', version: '1.0.0' }).id,
    scopeId: `fixture:${Date.now()}:${Math.random()}`,
    process: 'runtime',
  });
}
