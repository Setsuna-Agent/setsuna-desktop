import { useMemo, useState } from 'react';
import { Button, IconButton, TextField } from '@setsuna-desktop/renderer-ui';
import { Globe, Search, Trash2, X } from 'lucide-react';
import { useBrowserHistory } from '../useBrowserHistory.js';
import type { BrowserRecordsProps } from './BrowserRecordsManager.js';
import { BrowserRecordsHeader } from './BrowserRecordsHeader.js';
import { BrowserRecordsConfirmation } from './BrowserRecordsConfirmation.js';
import { browserHistoryDay, groupBrowserHistory } from './historyGroups.js';

export function BrowserHistoryRecords(props: BrowserRecordsProps) {
  const { translate: t, onNavigate, onClose, pinned } = props;
  const history = useBrowserHistory();
  const [query, setQuery] = useState('');
  const [clearing, setClearing] = useState(false);
  const groups = useMemo(() => groupBrowserHistory(history.entries, query), [history.entries, query]);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (day: string, timestamp: number) => {
    const relative = day === browserHistoryDay(Date.now()) ? t('feature.browser.records.today')
      : day === browserHistoryDay(yesterday.getTime()) ? t('feature.browser.records.yesterday') : '';
    return `${relative ? `${relative} · ` : ''}${dateFormat.format(timestamp)}`;
  };
  return <>
    <BrowserRecordsHeader {...props} title={t('feature.browser.settings.history')} actions={
      <IconButton label={t('feature.browser.records.clearHistory')} disabled={!history.entries.length} onClick={() => setClearing(true)}><Trash2 size={14} /></IconButton>
    } />
    {clearing ? <BrowserRecordsConfirmation title={t('feature.browser.records.clearHistoryConfirm')} translate={t}
      onCancel={() => setClearing(false)} onConfirm={() => { if (history.clear()) setClearing(false); }} /> : <>
      <div className="browser-records__search"><Search size={14} aria-hidden="true" /><TextField
        aria-label={t('feature.browser.settings.search')} placeholder={t('feature.browser.records.searchHistory')}
        value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="browser-records__scroll">{groups.map((group) => <section key={group.day}>
        <header className="browser-records__day"><h3>{dayLabel(group.day, group.timestamp)}</h3>
          <IconButton label={`${t('feature.browser.records.deleteDay')} ${dayLabel(group.day, group.timestamp)}`}
            onClick={() => history.removeDay(group.day)}><X size={12} /></IconButton>
        </header>
        <ul className="browser-records__list">{group.entries.map((item) => <li key={item.url}>
          <Button variant="ghost" className="browser-records__link" disabled={!onNavigate} title={item.url}
            aria-label={`${t('feature.browser.historyOpen')} ${item.title}`} onClick={() => { if (!pinned) onClose(); onNavigate?.(item.url); }}>
            <Globe size={14} aria-hidden="true" /><span className="browser-records__title">{item.title}</span>
            <time dateTime={new Date(item.visitedAt).toISOString()}>{timeFormat.format(item.visitedAt)}</time>
          </Button>
          <IconButton className="browser-records__row-action" label={`${t('feature.browser.settings.remove')} ${item.title}`}
            onClick={() => history.removeEntry(item.url)}><X size={12} /></IconButton>
        </li>)}</ul>
      </section>)}
      {!groups.length ? <div className="browser-records__empty">{t('feature.browser.settings.empty')}</div> : null}</div>
    </>}
    {history.error ? <p role="alert" className="browser-records__error">{t('feature.browser.settings.failed')}</p> : null}
  </>;
}
