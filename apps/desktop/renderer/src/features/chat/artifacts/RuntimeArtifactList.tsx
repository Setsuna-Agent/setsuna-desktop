import type { RuntimeArtifact } from '@setsuna-desktop/contracts';
import { RuntimeArtifactCard } from './RuntimeArtifactCard.js';

export function RuntimeArtifactList({ artifacts }: { artifacts: readonly RuntimeArtifact[] }) {
  if (!artifacts.length) return null;
  return (
    <section className="chat-artifact-list" aria-label="生成的产物">
      {artifacts.map((artifact) => <RuntimeArtifactCard artifact={artifact} key={artifact.id} />)}
    </section>
  );
}
