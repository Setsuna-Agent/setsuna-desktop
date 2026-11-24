import { lazy, useMemo, type ReactNode } from 'react';
import { DesignUiHostContext, type DesignClient } from '@setsuna-desktop/feature-design/renderer';
import { BrandIconMark } from '../../shared/branding/BrandIconMark.js';
import { resolveBrandIcon } from '../../shared/branding/providerBranding.js';
import { copyTextToClipboard } from '../../shared/lib/clipboard.js';
import { ProjectIcon } from '../../shared/ui/ProjectIcon.js';
import { ScrollOverlay } from '../../shared/ui/ScrollOverlay.js';
import { DesignClientContext } from './design-client-context.js';

export { useDesignClient } from './design-client-context.js';

const DesignShortcutsSettings = lazy(() => import('./DesignShortcutsSettings.js'));
const mcpPromptModelIcon = <BrandIconMark brand={resolveBrandIcon({ type: 'preset', key: 'openai' }, null)}
  fallbackName="OpenAI" size="compact" />;

export function DesignFeatureServiceBoundary({ client, children }: Readonly<{ client: DesignClient | null; children: ReactNode }>) {
  const mcp = window.setsunaDesktop?.designMcp;
  const designUiHost = useMemo(() => ({
    ShortcutSettings: DesignShortcutsSettings, ScrollOverlay, ProjectIcon, copyText: copyTextToClipboard, mcp, mcpPromptModelIcon,
  }), [mcp]);
  return <DesignClientContext.Provider value={client}>
    <DesignUiHostContext.Provider value={designUiHost}>{children}</DesignUiHostContext.Provider>
  </DesignClientContext.Provider>;
}
