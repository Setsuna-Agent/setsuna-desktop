import { useEffect, useState } from 'react';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { BrowserStartPageSearch } from '../../../composition/BrowserWorkspaceFeatureBoundary.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

export function WorkspaceOverviewHeader({ onNavigate }: { onNavigate(url: string): void }) {
  const { locale, t } = useI18n();
  const toast = useToast();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      // Align to the next minute, and resync immediately after the window becomes visible.
      timer = setTimeout(refresh, 60_000 - current.getTime() % 60_000);
    };
    const onVisibilityChange = () => { if (!document.hidden) refresh(); };
    refresh();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, []);

  return <header className="desktop-workspace-overview__header">
    <div className="desktop-workspace-overview__clock">
      <time dateTime={now.toISOString()} className="desktop-workspace-overview__time">
        {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
      </time>
      <span className="desktop-workspace-overview__date">
        {now.toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'long' })}
      </span>
    </div>
    <BrowserStartPageSearch bridge={window.setsunaDesktop?.browser ?? null} onNavigate={onNavigate}
      onError={toast.error} translate={t} />
  </header>;
}
