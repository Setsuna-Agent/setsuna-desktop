// @vitest-environment happy-dom

import type { RuntimeRequestInput } from '@setsuna-desktop/contracts';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureContributionBoundary } from '../../../src/composition/FeatureContributionBoundary.js';
import { FeatureRecoveryShell } from '../../../src/composition/FeatureRecoveryShell.js';

describe('Feature recovery UI', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
  });

  it('isolates a throwing contribution and can retry it without replacing the host page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;
    const { rerender } = render(
      <FeatureContributionBoundary
        fallback={(reset) => <button type="button" onClick={reset}>Retry contribution</button>}
        featureId="fixture"
        resetKey="fixture:1"
      >
        <ThrowingView shouldThrow={shouldThrow} />
      </FeatureContributionBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Retry contribution' })).toBeTruthy();
    shouldThrow = false;
    rerender(
      <FeatureContributionBoundary
        fallback={(reset) => <button type="button" onClick={reset}>Retry contribution</button>}
        featureId="fixture"
        resetKey="fixture:1"
      >
        <ThrowingView shouldThrow={shouldThrow} />
      </FeatureContributionBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry contribution' }));

    expect(screen.getByText('Feature view ready')).toBeTruthy();
  });

  it('requires a second explicit action and the latest diagnosisId before resetting', async () => {
    let resetCompleted = false;
    const request = vi.fn(async (input: RuntimeRequestInput) => {
      if (input.path === '/v1/feature-management/status') {
        return success({
          features: [{
            featureId: 'image-generation',
            criticality: 'optional',
            status: 'degraded',
          }],
          settings: [{ featureId: 'image-generation', documentId: 'connection' }],
        });
      }
      if (input.path.endsWith('/diagnosis')) {
        return success({
          featureId: 'image-generation',
          documentId: 'connection',
          status: resetCompleted ? 'ok' : 'schema-invalid',
          diagnosisId: resetCompleted ? 'diagnosis-2' : 'diagnosis-1',
        });
      }
      if (input.path.endsWith('/reset')) {
        expect(input.method).toBe('POST');
        expect(input.body).toEqual({ expectedDiagnosisId: 'diagnosis-1', confirmed: true });
        resetCompleted = true;
        return success({ revision: 1 });
      }
      throw new Error(`Unexpected request: ${input.path}`);
    });
    installRuntimeBridge(request);
    const user = userEvent.setup();

    render(
      <FeatureRecoveryShell
        candidateFeatureIds={['image-generation']}
        reason="view-missing"
      />,
    );

    expect(await screen.findByText('Schema 无效')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重置文档' }));
    expect(screen.getByText(/原文件会先移入受控隔离区/u)).toBeTruthy();
    expect(request.mock.calls.some(([input]) => input.path.endsWith('/reset'))).toBe(false);

    await user.click(screen.getByRole('button', { name: '确认重置' }));
    await waitFor(() => expect(screen.getByText('文档正常')).toBeTruthy());
    expect(request.mock.calls.filter(([input]) => input.path.endsWith('/reset'))).toHaveLength(1);
  });
});

function ThrowingView({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('fixture view failed');
  return <div>Feature view ready</div>;
}

function success(value: unknown) {
  return { ok: true as const, value };
}

function installRuntimeBridge(request: (input: RuntimeRequestInput) => Promise<unknown>): void {
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true,
    value: {
      runtime: {
        request,
        cancelRequest: vi.fn(async () => true),
      },
    },
  });
}
