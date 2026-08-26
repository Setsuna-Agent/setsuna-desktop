import type { RuntimeThread } from '@setsuna-desktop/contracts';
import type { UsageRendererStateService } from '@setsuna-desktop/feature-usage/contracts';
import {
  UsageConversationSummary,
  UsageRendererProvider,
  useUsageRendererService,
  type UsageBrandIconProps,
  type UsageRendererHost,
} from '@setsuna-desktop/feature-usage/renderer';
import { useCallback, type ReactNode } from 'react';
import { BrandIconMark } from '../shared/branding/BrandIconMark.js';
import { useI18n } from '../shared/i18n/I18nProvider.js';
import { AppTooltip } from '../shared/ui/primitives.js';
import { usageModelBrand, usageProviderBrand } from './usage-feature-branding.js';

export const usageRendererHost: UsageRendererHost = Object.freeze({
  BrandIcon: UsageBrandIcon,
  Tooltip: AppTooltip,
});

export function UsageFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: UsageRendererStateService;
}>) {
  const { t } = useI18n();
  return (
    <UsageRendererProvider host={usageRendererHost} service={service} translate={t}>
      {children}
    </UsageRendererProvider>
  );
}

export function UsageFeatureConversationSummary({ thread }: Readonly<{ thread: RuntimeThread }>) {
  const service = useUsageRendererService();
  if (!service.available) return null;
  return <UsageConversationSummary thread={thread} />;
}

export function useUsageFeatureInvalidation(): (threadId: string) => void {
  const service = useUsageRendererService();
  return useCallback((threadId: string) => service.invalidate(threadId), [service]);
}

function UsageBrandIcon({
  kind,
  name,
  providerId,
  providerName,
  providers,
}: UsageBrandIconProps) {
  const brand = kind === 'provider'
    ? usageProviderBrand(providers, name, providerId)
    : usageModelBrand(providers, name, providerId, providerName);
  return <BrandIconMark brand={brand} fallbackName={name} size="compact" />;
}
