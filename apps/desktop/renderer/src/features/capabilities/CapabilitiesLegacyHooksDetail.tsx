import type { RuntimeHookMetadata } from '@setsuna-desktop/contracts';
import { AlertTriangle, Loader2, Power, PowerOff, ShieldCheck, ShieldOff, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton, PageHeader } from '../../shared/ui/primitives.js';
import { CapabilitiesPluginDetailSection } from './CapabilitiesPluginDetailSection.js';
import { CapabilitiesPluginItemIcon } from './CapabilitiesPluginItemButton.js';
import { CapabilitiesTopbarBreadcrumb } from './CapabilitiesTopbarBreadcrumb.js';

export function CapabilitiesLegacyHooksDetail({
  hooks,
  onBack,
  onDelete,
  onSetEnabled,
  onSetTrust,
}: {
  hooks: RuntimeHookMetadata[];
  onBack: () => void;
  onDelete: (hook: RuntimeHookMetadata) => Promise<void>;
  onSetEnabled: (hook: RuntimeHookMetadata, enabled: boolean) => Promise<void>;
  onSetTrust: (hook: RuntimeHookMetadata, trusted: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function runAction(hook: RuntimeHookMetadata, action: () => Promise<void>) {
    setPendingKeys((current) => new Set(current).add(hook.key));
    setError(null);
    try {
      await action();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(hook.key);
        return next;
      });
    }
  }

  return (
    <>
      <CapabilitiesTopbarBreadcrumb
        currentLabel={t('capabilities.legacyHooks.name')}
        parentLabel={t('capabilities.tab.plugins')}
        onBack={onBack}
      />
      <section className="desktop-capabilities-detail desktop-capabilities-plugin-detail desktop-capabilities-legacy-hooks">
      <PageHeader
        title={t('capabilities.legacyHooks.name')}
        subtitle={t('capabilities.legacyHooks.description')}
      />
      {error ? <div className="desktop-capabilities-errors" role="alert">{error}</div> : null}
      <div className="desktop-capabilities-usage-note">
        <AlertTriangle size={14} aria-hidden="true" />
        <span>{t('capabilities.legacyHooks.migrationHint')}</span>
      </div>
      <CapabilitiesPluginDetailSection
        icon={<Workflow size={15} />}
        title="Hooks"
        count={hooks.length}
      >
        {hooks.map((hook) => {
          const pending = pendingKeys.has(hook.key);
          const trusted = hook.trustStatus === 'trusted' || hook.trustStatus === 'managed';
          const trustLabel = t(trusted ? 'capabilities.hookAction.revoke' : 'capabilities.hookAction.trust');
          const enabledLabel = t(hook.enabled ? 'capabilities.hookAction.disable' : 'capabilities.hookAction.enable');
          return (
            <div className="desktop-capabilities-plugin-detail__item is-static" key={hook.key}>
              <CapabilitiesPluginItemIcon><Workflow size={16} /></CapabilitiesPluginItemIcon>
              <span className="desktop-capabilities-plugin-detail__item-body">
                <strong>{hook.eventName}{hook.matcher ? ` · ${hook.matcher}` : ''}</strong>
                <small title={hook.command ?? undefined}>{hook.command ?? hook.statusMessage ?? hook.sourcePath}</small>
              </span>
              <span className="desktop-capabilities-legacy-hooks__actions" role="group" aria-label={hook.eventName}>
                {pending ? <Loader2 className="is-spinning" size={15} aria-label={t('capabilities.common.saving')} /> : (
                  <>
                    <IconButton
                      label={trustLabel}
                      disabled={pending}
                      onClick={() => {
                        if (!trusted && !window.confirm(t('capabilities.hookAction.confirmTrust'))) return;
                        void runAction(hook, () => onSetTrust(hook, !trusted));
                      }}
                    >
                      {trusted ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                    </IconButton>
                    <IconButton
                      label={enabledLabel}
                      disabled={pending}
                      onClick={() => void runAction(hook, () => onSetEnabled(hook, !hook.enabled))}
                    >
                      {hook.enabled ? <PowerOff size={15} /> : <Power size={15} />}
                    </IconButton>
                    <IconButton
                      label={t('capabilities.hookAction.delete')}
                      variant="danger"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(t('capabilities.hookAction.confirmDelete'))) return;
                        void runAction(hook, () => onDelete(hook));
                      }}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </CapabilitiesPluginDetailSection>
      </section>
    </>
  );
}
