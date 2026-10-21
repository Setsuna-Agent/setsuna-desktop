import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { UsageFilterSkeleton, UsageSkeleton } from './usage/UsageSkeleton.js';

export function UsageSettingsLoading({ translate: t, ui }: { translate: RendererTranslate; ui: SettingsViewUi }) {
  return <>
    <ui.PageHeading title={t('feature.usage.settings.title')} description={t('feature.usage.settings.description')}
      action={<UsageFilterSkeleton />} />
    <ui.Section className="feature-usage" featureId="usage">
      <div className="feature-usage-loading" role="status" aria-label={t('feature.usage.loading')} aria-busy="true">
        <UsageSkeleton kind="overview" />
        <div className="feature-usage-loading__breakdowns"><UsageSkeleton kind="breakdown" /><UsageSkeleton kind="breakdown" /></div>
        <UsageSkeleton kind="calendar" />
        <UsageSkeleton kind="records" />
      </div>
    </ui.Section>
  </>;
}
