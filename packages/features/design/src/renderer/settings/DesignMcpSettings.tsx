import { ChevronDown, Copy, Cpu, FileText, Image as ImageIcon, Layers, PenTool, Plus } from 'lucide-react';
import { useContext, useEffect, useId, useState } from 'react';
import type { RendererFeatureMessageKey, RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Switch, useToast } from '@setsuna-desktop/renderer-ui';
import { designMcpClients, designMcpName, designMcpToolNames,
  type DesignMcpBridge, type DesignMcpClient, type DesignMcpSettings as Settings } from '../../contracts/design-mcp.js';
import { DesignUiHostContext } from '../context/design-ui-host.js';

const clientNames = { codex: 'Codex', 'claude-code': 'Claude Code' };
const toolIcons = {
  [designMcpToolNames.active]: FileText,
  [designMcpToolNames.inspect]: Layers,
  [designMcpToolNames.preview]: ImageIcon,
};

export function DesignMcpSettings({ bridge, copyText, translate: t }: Readonly<{
  bridge: DesignMcpBridge;
  copyText(value: string): Promise<void>;
  translate: RendererTranslate;
}>) {
  const toast = useToast();
  const modelIcon = useContext(DesignUiHostContext)?.mcpPromptModelIcon;
  const serviceNameId = useId();
  const promptId = useId();
  const copyNameLabel = t('feature.design.settings.mcp.copyName', { name: designMcpName });
  const copyPromptLabel = t('feature.design.settings.mcp.copyPrompt');
  const prompt = t('feature.design.settings.mcp.prompt', { name: designMcpName });
  const [settings, setSettings] = useState<Settings>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void bridge.settings().then((value) => { if (!cancelled) setSettings(value); }).catch((error: unknown) => {
      if (!cancelled) toast.error(t('feature.design.settings.mcp.failed', { error: errorMessage(error) }));
    });
    return () => { cancelled = true; };
  }, [bridge, t, toast]);

  async function run(action: () => Promise<void>, failure: RendererFeatureMessageKey = 'feature.design.settings.mcp.failed') {
    setPending(true);
    try {
      await action();
    } catch (error) {
      toast.error(t(failure, { error: errorMessage(error) }));
    } finally {
      setPending(false);
    }
  }

  function toggle(client: DesignMcpClient, enabled: boolean) {
    void run(async () => {
      try {
        setSettings(await bridge.setEnabled(client, enabled));
      } catch (error) {
        // Revocation can succeed even when the client configuration cannot be cleaned up.
        const current = await bridge.settings().catch(() => undefined);
        if (current) setSettings(current);
        throw error;
      }
    });
  }

  function copy(action: () => Promise<void>, failure?: RendererFeatureMessageKey) {
    void run(async () => {
      await action();
      toast.success(t('feature.design.copied'));
    }, failure);
  }

  return <>
    <section className="design-settings__mcp-card" aria-labelledby={serviceNameId}>
      <header className="design-settings__mcp-card-header">
        <span className="design-settings__mcp-card-icon" aria-hidden="true"><PenTool size={20} /></span>
        <div>
          <h2>
            <Button variant="ghost" size="small" className="design-settings__mcp-service-name" title={copyNameLabel} aria-label={copyNameLabel}
              disabled={pending} onClick={() => copy(() => copyText(designMcpName), 'feature.design.clipboardFailed')}>
              <span id={serviceNameId}>{designMcpName}</span>
              <Copy size={14} aria-hidden="true" />
            </Button>
          </h2>
          <p className="design-settings__mcp-card-scope">{t('feature.design.settings.mcp.scope')}</p>
        </div>
      </header>
      <ul className="design-settings__mcp-tools">
        {Object.entries(designMcpToolNames).map(([kind, name]) => {
          const Icon = toolIcons[name];
          return <li className="design-settings__mcp-tool" key={name}>
            <span className="design-settings__mcp-tool-icon" aria-hidden="true"><Icon size={15} /></span>
            <div>
              <div className="design-settings__mcp-tool-heading">
                <h3>{t(`feature.design.settings.mcp.title.${kind}`)}</h3>
                <code>{name}</code>
              </div>
              <p>{t(`feature.design.settings.mcp.tool.${kind}`)}</p>
              <p className="design-settings__mcp-tool-example">{t(`feature.design.settings.mcp.example.${kind}`)}</p>
            </div>
          </li>;
        })}
      </ul>
    </section>
    <div className="design-settings__controls design-settings__mcp">
      {designMcpClients.map((client) => (
        <div className="design-settings__row" key={client}>
          <span className="design-settings__row-label">{clientNames[client]}</span>
          <Switch label={clientNames[client]} checked={settings?.[client] ?? false} disabled={pending || !settings}
            onCheckedChange={(enabled) => toggle(client, enabled)} />
        </div>
      ))}
      <div className="design-settings__row">
        <span className="design-settings__row-label">{t('feature.design.settings.mcp.otherClients')}</span>
        <div className="design-settings__mcp-actions">
          {settings?.manual ? <Button size="small" disabled={pending} onClick={() => {
            void run(async () => { setSettings(await bridge.revokeManual()); });
          }}>{t('feature.design.settings.mcp.revokeManual')}</Button> : null}
          <Button size="small" icon={<Copy size={14} />} disabled={pending || !settings}
            onClick={() => copy(async () => { setSettings(await bridge.copyConfig()); })}>
            {t('feature.design.settings.mcp.copy')}
          </Button>
        </div>
      </div>
    </div>
    <section aria-labelledby={promptId}>
      <h2 id={promptId} className="design-settings__mcp-prompt-title">{t('feature.design.settings.mcp.promptLabel')}</h2>
      <div className="design-settings__mcp-prompt">
        <p className="design-settings__mcp-prompt-text">{prompt}</p>
        <div className="design-settings__mcp-prompt-footer">
          <div className="design-settings__mcp-prompt-tools" aria-hidden="true">
            <Plus size={15} />
            <span className="design-settings__mcp-prompt-model">
              {modelIcon ?? <Cpu size={13} />}
              <span>GPT-5.2</span>
              <ChevronDown size={12} />
            </span>
          </div>
          <Button className="sd-icon-button design-settings__mcp-prompt-copy" variant="primary" size="small" aria-label={copyPromptLabel}
            title={copyPromptLabel} disabled={pending} onClick={() => copy(() => copyText(prompt), 'feature.design.clipboardFailed')}>
            <Copy size={15} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  </>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
