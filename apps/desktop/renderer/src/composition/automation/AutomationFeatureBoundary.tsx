import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { AutomationPage, automationSetupPending, type AutomationClient } from '@setsuna-desktop/feature-automation/renderer';
import { ChatRouteAdapter } from '../../app/layout/ChatRouteAdapter.js';
import type { AppRouteContentProps } from '../../app/layout/AppRouteContent.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { AutomationTopbar } from './AutomationTopbar.js';
import { AutomationModelPicker } from './AutomationModelPicker.js';

const AutomationClientContext = createContext<AutomationClient | null>(null);
export function AutomationFeatureServiceBoundary({ client, children }: { client: AutomationClient | null; children: ReactNode }) {
  return <AutomationClientContext.Provider value={client}>{children}</AutomationClientContext.Provider>;
}

/** Reuses the host's full conversation surface and its existing SSE owner. */
export function AutomationRouteAdapter(props: AppRouteContentProps) {
  const client = useContext(AutomationClientContext);
  const { t, locale } = useI18n();
  const reloadThreads = props.runtime.reloadThreads;
  const openConversation = useCallback(async (threadId: string) => {
    const selected = await props.onSelectConversation?.(threadId, 'automation') ?? false;
    if (selected) await reloadThreads();
    return selected;
  }, [props.onSelectConversation, reloadThreads]);
  if (!client) return <main className="automation-main automation-loading" role="alert">{t('feature.automation.unavailable')}</main>;
  return <AutomationPage client={client} threadId={props.runtime.currentThread?.id} openConversation={openConversation}
    ModelPicker={AutomationModelPicker}
    onSelectStarterPrompt={props.setDraft}
    renderToolbar={(toolbar) => <AutomationTopbar {...toolbar} />}
    renderConversation={(starterContent, starterFooter, turnNavigationRequest) => <ChatRouteAdapter {...props}
      turnNavigationRequest={turnNavigationRequest}
      conversationOverviewVisibility={starterContent ? 'hidden' : props.conversationOverviewVisibility}
      starterPresentation={starterContent ? { content: starterContent, footer: starterFooter, visible: automationSetupPending(props.runtime.currentThread) } : undefined}
    />} translate={t} locale={locale} />;
}
