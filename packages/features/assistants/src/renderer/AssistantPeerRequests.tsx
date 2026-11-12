import { useId, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { UserRound, Users } from 'lucide-react';
import { assistantPeerLabel, type AssistantsSnapshot } from '../contracts/index.js';
import type { AssistantsRendererService } from './client.js';
import { useAssistantPeerActions } from './useAssistantPeerActions.js';

export function AssistantPeerRequests({ assistantId, snapshot, service, translate: t }: {
  assistantId: string; snapshot: AssistantsSnapshot; service: AssistantsRendererService; translate: RendererTranslate;
}) {
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  const actions = useAssistantPeerActions({ service, onError: setError });
  const peers = snapshot.peers.filter((peer) => peer.assistantId === assistantId && peer.status === 'pending');

  return <>
    {peers.length ? <section className="assistant-peer-requests" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('feature.assistants.peer.requests')}</h3>
      <div className="assistant-peer-requests__list">{peers.map((peer) => {
        const kind = t(`feature.assistants.peer.${peer.kind}`);
        const label = assistantPeerLabel(peer, kind);
        const Icon = peer.kind === 'group' ? Users : UserRound;
        return <div key={`${peer.kind}:${peer.openid}`} className="assistant-peer-requests__row" role="group" aria-label={`${kind} · ${label}`}>
          <Icon size={16} aria-hidden="true" />
          <span className="assistant-peer-requests__name" title={`${kind} · ${peer.openid}`}>{label}</span>
          <Button size="small" variant="ghost" disabled={actions.busy} onClick={() => actions.updatePeer(peer, 'removed')}>
            {t('feature.assistants.peer.remove')}
          </Button>
          <Button size="small" variant="primary" disabled={actions.busy} onClick={() => actions.updatePeer(peer, 'allowed')}>
            {t('feature.assistants.peer.allow')}
          </Button>
        </div>;
      })}</div>
    </section> : null}
    <ToastNotice message={error} />
  </>;
}
