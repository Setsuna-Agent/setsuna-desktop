import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import type { UsageRendererStateService } from '../contracts/index.js';
import type { UsageRendererHost } from './capabilities.js';
import { UsageSettingsLoading } from './UsageSettingsLoading.js';
import { UsageSettings } from './usage/UsageSettings.js';
import { UsageViewProvider } from './usage/view-context.js';
import { useUsageSettingsData } from './useUsageSettingsData.js';
import './usage.css';

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
  const { snapshot, loading, error, refresh, query } = useUsageSettingsData(service);

  const { Button, EmptyState, PageHeading, Section } = ui;
  return (
    <UsageViewProvider host={host} translate={translate} ui={ui}>
      {snapshot ? (
        <UsageSettings
          providers={snapshot.providers}
          usage={snapshot.usage}
          onQueryUsage={query}
        />
      ) : loading ? <UsageSettingsLoading translate={translate} ui={ui} /> : (
        <>
          <PageHeading
            description={translate('feature.usage.settings.description')}
            title={translate('feature.usage.settings.title')}
          />
          <Section className="feature-usage" featureId="usage">
            {error ? (
              <EmptyState
                title={translate('feature.usage.loadFailed')}
                body={error}
                action={(
                  <Button onClick={refresh}>{translate('feature.usage.retry')}</Button>
                )}
              />
            ) : null}
          </Section>
        </>
      )}
      {snapshot && error ? <ui.Toast tone="error" message={translate('feature.usage.loadFailed')} /> : null}
    </UsageViewProvider>
  );
}
