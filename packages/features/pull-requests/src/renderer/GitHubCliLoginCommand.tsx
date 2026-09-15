import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import { Check, Copy } from 'lucide-react';
import { errorText, usePrText, usePullRequestsHost } from './context.js';

export function GitHubCliLoginCommand({ command }: { command: string }) {
  const t = usePrText();
  const host = usePullRequestsHost();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setCopied(false); return () => clearTimeout(timer.current); }, [command]);
  const copy = async () => {
    try {
      await host.copyText(command);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch (error) { host.notifyError(t('copyFailed', { error: errorText(error) })); }
  };
  return <div className="pr-cli-setup"><code>{command}</code><IconButton size="small" label={t(copied ? 'copied' : 'copyLoginCommand')} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton></div>;
}
