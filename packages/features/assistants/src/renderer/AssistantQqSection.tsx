import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Switch, TextField } from '@setsuna-desktop/renderer-ui';
import { CircleHelp } from 'lucide-react';
import { assistantPeerLabel, type Assistant, type AssistantQqPeer, type AssistantsSnapshot } from '../contracts/index.js';
import type { AssistantsRendererService } from './client.js';
import type { AssistantForm } from './form.js';
import { AssistantQqSecretField } from './AssistantQqSecretField.js';
import { errorMessage } from './errors.js';

type SectionProps = {
  assistant?: Assistant; snapshot: AssistantsSnapshot; form: AssistantForm; busy: boolean;
  service: AssistantsRendererService; translate: RendererTranslate;
  onChange<K extends keyof AssistantForm>(key: K, value: AssistantForm[K]): void;
  onError(message: string): void;
  onOpenGuide(trigger: HTMLButtonElement): void;
};

/**
 * QQ bot credentials and the chats allowed to reach this assistant. Peer changes apply
 * immediately; credentials are saved with the rest of the form.
 */
export function AssistantQqSection({ assistant, snapshot, form, busy, service, translate: t, onChange, onError, onOpenGuide }: SectionProps) {
  const connector = snapshot.connectors.find((item) => item.assistantId === assistant?.id);
  const secretConfigured = connector?.secretConfigured === true;
  const peers = snapshot.peers.filter((peer) => peer.assistantId === assistant?.id);
  const apply = (action: () => Promise<unknown>) => { void action().catch((error: unknown) => onError(errorMessage(error))); };
  const updatePeer = (peer: AssistantQqPeer, change: { status: 'allowed' | 'removed' }) => apply(async () => {
    if (!assistant) return;
    service.store.publish(await service.client.updatePeer(assistant.id, { kind: peer.kind, openid: peer.openid, ...change }));
  });
  return <section className="assistant-form__qq">
    <div className="assistant-form__qq-header">
      <h3 className="sd-form-label">{t('feature.assistants.qq')}</h3>
      <Button variant="ghost" size="small" disabled={busy} icon={<CircleHelp size={14} aria-hidden="true" />}
        onClick={(event) => onOpenGuide(event.currentTarget)}>{t('feature.assistants.qqGuide')}</Button>
    </div>
    <div className="sd-form-stack">
      <label className="sd-form-field"><span className="sd-form-label">{t('feature.assistants.qqAppId')}</span>
        <TextField disabled={busy} inputMode="numeric" maxLength={64} value={form.qqAppId} onChange={(event) => onChange('qqAppId', event.target.value)} />
      </label>
      <AssistantQqSecretField key={`${assistant?.id ?? 'new'}:${secretConfigured}`} assistantId={assistant?.id}
        configured={secretConfigured} value={form.qqSecret} disabled={busy} client={service.client} translate={t}
        onChange={(value) => onChange('qqSecret', value)} onError={onError} />
      <div className="sd-form-row"><span className="sd-form-label">{t('feature.assistants.qqEnabled')}</span>
        <Switch disabled={busy} checked={form.qqEnabled} label={t('feature.assistants.qqEnabled')} onCheckedChange={(value) => onChange('qqEnabled', value)} />
      </div>
      <div className="sd-form-row"><span className="sd-form-label">{t('feature.assistants.qqMarkdownEnabled')}</span>
        <Switch disabled={busy} checked={form.qqMarkdownEnabled} label={t('feature.assistants.qqMarkdownEnabled')} onCheckedChange={(value) => onChange('qqMarkdownEnabled', value)} />
      </div>
    </div>
    {peers.length ? <div className="assistant-form__peers">
      {peers.map((peer) => <div key={`${peer.kind}:${peer.openid}`} className="assistant-form__peer">
        <span className="assistant-form__peer-name" title={peer.openid}>
          <span className="assistant-form__peer-label">{assistantPeerLabel(peer, t(`feature.assistants.peer.${peer.kind}`))}</span>
          {peer.status === 'pending' ? <em>{t('feature.assistants.peer.pending')}</em> : null}
        </span>
        {peer.status === 'pending'
          ? <Button size="small" disabled={busy} onClick={() => updatePeer(peer, { status: 'allowed' })}>{t('feature.assistants.peer.allow')}</Button>
          : null}
        <Button size="small" variant="ghost" disabled={busy} onClick={() => updatePeer(peer, { status: 'removed' })}>{t('feature.assistants.peer.remove')}</Button>
      </div>)}
    </div> : null}
  </section>;
}
