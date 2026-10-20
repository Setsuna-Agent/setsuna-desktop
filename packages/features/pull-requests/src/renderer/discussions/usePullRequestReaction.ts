import { useEffect, useRef, useState } from 'react';
import type { PullRequestReaction, PullRequestReference } from '../../contracts/index.js';
import { isAccountChangedError, type PullRequestsClient } from '../client.js';
import { errorText, usePrText, usePullRequestsHost } from '../context.js';

export function usePullRequestReaction({ client, reference, subjectId, account, reactions, onUpdated }: {
  client: PullRequestsClient; reference: PullRequestReference; subjectId: string; account: string;
  reactions: readonly PullRequestReaction[]; onUpdated(): void;
}) {
  const t = usePrText();
  const { notifyError } = usePullRequestsHost();
  const [result, setResult] = useState<{ source: readonly PullRequestReaction[]; items: PullRequestReaction[] }>();
  const [pending, setPending] = useState(false);
  const current = useRef({ reactions, onUpdated });
  current.current = { reactions, onUpdated };
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const items = result?.source === reactions ? result.items : reactions;
  const toggle = async (content: PullRequestReaction['content']) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const response = await client.react({
        repository: reference.repository, number: reference.number, subjectId, expectedAccount: account, content,
        action: items.find((item) => item.content === content)?.viewerHasReacted ? 'remove' : 'add',
      });
      if (alive.current) {
        setResult({ source: current.current.reactions, items: response.reactions });
        current.current.onUpdated();
      }
    } catch (cause) {
      if (alive.current) notifyError(isAccountChangedError(cause) ? t('accountChanged') : t('reactionFailed', { error: errorText(cause) }));
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  };
  return { items, pending, toggle };
}
