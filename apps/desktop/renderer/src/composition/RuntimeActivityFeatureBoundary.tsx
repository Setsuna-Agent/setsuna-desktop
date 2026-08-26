import type { RuntimeActivityRendererService } from '@setsuna-desktop/feature-runtime-activity/contracts';
import {
  RuntimeActivityCenter,
  RuntimeActivityMenuItem,
  type RuntimeActivityCenterProps,
} from '@setsuna-desktop/feature-runtime-activity/renderer';
import { createContext, useContext, type ReactNode } from 'react';
import { useI18n } from '../shared/i18n/I18nProvider.js';
import { Button, IconButton } from '../shared/ui/primitives.js';

const RuntimeActivityFeatureContext = createContext<RuntimeActivityRendererService | null>(null);

export function RuntimeActivityFeatureServiceBoundary({
  children,
  service,
}: Readonly<{ children: ReactNode; service: RuntimeActivityRendererService }>) {
  return (
    <RuntimeActivityFeatureContext.Provider value={service}>
      {children}
    </RuntimeActivityFeatureContext.Provider>
  );
}

export function RuntimeActivityFeatureCenter(
  props: Omit<RuntimeActivityCenterProps, 'service' | 'translate' | 'ui'>,
) {
  const { t } = useI18n();
  const service = useRuntimeActivityFeatureService();
  return (
    <RuntimeActivityCenter
      {...props}
      service={service}
      translate={t}
      ui={{ Button, IconButton }}
    />
  );
}

export function RuntimeActivityFeatureMenuItem({ onClick }: Readonly<{ onClick: () => void }>) {
  const { t } = useI18n();
  return <RuntimeActivityMenuItem onClick={onClick} translate={t} />;
}

function useRuntimeActivityFeatureService(): RuntimeActivityRendererService {
  const service = useContext(RuntimeActivityFeatureContext);
  if (!service) throw new Error('RuntimeActivityFeatureServiceBoundary is missing.');
  return service;
}
