import type { RuntimeArtifact } from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { RuntimeArtifactCard } from './RuntimeArtifactCard.js';

export function RuntimeArtifactList({ artifacts }: { artifacts: readonly RuntimeArtifact[] }) {
  const { t } = useI18n();
  if (!artifacts.length) return null;
  return (
    <section className="chat-artifact-list" aria-label={t('chat.artifact.list')}>
      {artifacts.map((artifact) => <RuntimeArtifactCard artifact={artifact} key={artifact.id} />)}
    </section>
  );
}
