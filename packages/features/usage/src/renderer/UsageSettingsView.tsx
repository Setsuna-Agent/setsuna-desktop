import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import { useCallback, useEffect, useState } from 'react';
import type {
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  UsageRendererStateService,
  UsageSnapshot,
} from '../contracts/index.js';
import type { UsageRendererHost } from './capabilities.js';
import { UsageSettings } from './usage/UsageSettings.js';
import { UsageViewProvider } from './usage/view-context.js';
import './usage.css';
import './usage-filter.css';

export function UsageSettingsView({
  host,
  service,
  translate,
  ui,
}: Readonly<{
  host: UsageRendererHost;
  service: UsageRendererStateService;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(async (
    input: RuntimeUsageQuery = {},
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeUsageResponse> => {
    const next = await service.query(input, options);
    const isBaseQuery = Object.keys(input).length === 0;
    setSnapshot((current) => isBaseQuery || !current ? next : current);
    return next.usage;
  }, [service]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      await query({}, { signal });
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    let abort: AbortController | null = null;
    const refresh = () => {
      abort?.abort();
      abort = new AbortController();
      void load(abort.signal);
    };
    const unsubscribe = service.subscribeInvalidation(refresh);
    refresh();
    return () => {
      unsubscribe();
      abort?.abort();
    };
  }, [load, service]);

  const { Button, EmptyState, PageHeading, Section } = ui;
  return (
    <UsageViewProvider host={host} translate={translate} ui={ui}>
      {snapshot ? (
        <UsageSettings
          providers={snapshot.providers}
          usage={snapshot.usage}
          onQueryUsage={query}
        />
      ) : (
        <>
          <PageHeading
            description={translate('feature.usage.settings.description')}
            title={translate('feature.usage.settings.title')}
          />
          <Section className="feature-usage" featureId="usage">
            {loading ? <p className="feature-usage__status">{translate('feature.usage.loading')}</p> : null}
            {!loading && error ? (
              <EmptyState
                title={translate('feature.usage.loadFailed')}
                body={error}
                action={(
                  <Button onClick={() => void load()}>{translate('feature.usage.retry')}</Button>
                )}
              />
            ) : null}
          </Section>
        </>
      )}
    </UsageViewProvider>
  );
}
