import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Popover } from '@setsuna-desktop/renderer-ui';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CollaborationAgentConfiguration, CollaborationAgentIdentity } from '../contracts/index.js';
import { AgentAvatar } from './AgentAvatar.js';

export function CollaborationAgentInfo({ configuration, identity, modelLabel, modelIcon, translate: t }: Readonly<{
  configuration?: CollaborationAgentConfiguration;
  identity?: CollaborationAgentIdentity;
  modelLabel?: string;
  modelIcon?: ReactNode;
  translate: RendererTranslate;
}>) {
  if (!configuration && !modelLabel) return null;
  const effort = configuration?.thinking === false
    ? t('feature.collaboration.agent.thinkingOff')
    : configuration?.reasoningEffort
      ? configuration.reasoningEffort.charAt(0).toUpperCase() + configuration.reasoningEffort.slice(1)
      : configuration?.thinking ? t('feature.collaboration.agent.thinkingOn') : undefined;
  return (
    <span className="collaboration-agent-info">
      {configuration ? (
        <Popover placement="bottomLeft" contentLabel={t('feature.collaboration.agent.details')}
          className="collaboration-agent-info__popover"
          content={
            <dl className="collaboration-agent-info__details">
              <div><dt>{t('feature.collaboration.settings.name')}</dt><dd className="collaboration-agent-info__value">
                {identity ? <AgentAvatar identity={identity} size={16} /> : null}{configuration.role}
              </dd></div>
              {configuration.description ? <div className="collaboration-agent-info__text"><dt>{t('feature.collaboration.settings.description')}</dt><dd>{configuration.description}</dd></div> : null}
              {modelLabel ? <div><dt>{t('feature.collaboration.agent.model')}</dt><dd className="collaboration-agent-info__value">
                {modelIcon ? <span className="collaboration-agent-info__model-icon">{modelIcon}</span> : null}{modelLabel}
              </dd></div> : null}
              {effort ? <div><dt>{t('feature.collaboration.agent.effort')}</dt><dd><span className={configuration.thinking ? 'collaboration-agent-info__effort' : undefined}>{effort}</span></dd></div> : null}
              {configuration.instructions ? <div className="collaboration-agent-info__text"><dt>{t('feature.collaboration.settings.instructions')}</dt><dd>{configuration.instructions}</dd></div> : null}
            </dl>
          }
        >
          <Button variant="ghost" size="small" className="collaboration-agent-info__role"
            title={t('feature.collaboration.agent.details')}>
            {identity ? <AgentAvatar identity={identity} size={14} /> : null}
            <span>{configuration.role}</span><ChevronDown size={12} aria-hidden="true" />
          </Button>
        </Popover>
      ) : null}
      {modelLabel ? (
        <span className="collaboration-agent-info__model" title={modelLabel}>
          {modelIcon ? <span className="collaboration-agent-info__model-icon">{modelIcon}</span> : null}
          <span className="collaboration-agent-info__model-name">{modelLabel}</span>
        </span>
      ) : null}
      {configuration?.thinking && effort ? <span className="collaboration-agent-info__effort" title={t('feature.collaboration.agent.effort')}>{effort}</span> : null}
    </span>
  );
}
