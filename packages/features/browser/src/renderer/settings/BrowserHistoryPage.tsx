import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Globe, Trash2 } from 'lucide-react';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { BrowserTranslate } from '../messages.js';
import { useBrowserHistory } from '../useBrowserHistory.js';
import { groupBrowserHistory } from '../records/historyGroups.js';
import { BrowserSettingsSearch } from './BrowserSettingsSearch.js';
import './history-page.css';

export function BrowserHistoryPage({ translate: t, ui, onNavigate }: {
  translate: BrowserTranslate; ui: SettingsViewUi; onNavigate?: (url: string) => void;
}) {
  const history = useBrowserHistory();
  const [query, setQuery] = useState('');
  const [clearing, setClearing] = useState(false);
  const groups = useMemo(() => groupBrowserHistory(history.entries, query), [history.entries, query]);
  return <div className="browser-settings-collection">
    <BrowserSettingsSearch label={t('feature.browser.records.searchHistory')} value={query} onChange={setQuery} />
    <div className="browser-settings-page__toolbar">
      <h2>{t('feature.browser.settings.allHistory')}</h2>
      <ui.Button disabled={!history.entries.length || clearing} onClick={() => setClearing(true)}>{t('feature.browser.records.clearHistory')}</ui.Button>
    </div>
    {clearing ? <div className="browser-settings-page__card browser-settings-page__confirmation" role="group" aria-label={t('feature.browser.records.clearHistoryConfirm')}>
      <p>{t('feature.browser.records.clearHistoryConfirm')}</p>
      <div className="browser-settings__actions">
        <ui.Button onClick={() => setClearing(false)}>{t('feature.browser.settings.cancel')}</ui.Button>
        <ui.Button variant="danger" onClick={() => { if (history.clear()) setClearing(false); }}>{t('feature.browser.records.confirmDelete')}</ui.Button>
      </div>
    </div> : null}
    <div className="browser-history-page__days">{groups.map((group) => <BrowserHistoryDay key={group.day} group={group} query={query.trim()}
      history={history} onNavigate={onNavigate} translate={t} ui={ui} />)}</div>
    {!groups.length ? <p className="browser-settings-page__card browser-settings-page__status">{t('feature.browser.settings.empty')}</p> : null}
    {history.error ? <p role="alert" className="browser-settings-page__error">{t('feature.browser.settings.failed')}</p> : null}
  </div>;
}

function BrowserHistoryDay({ group, query, history, onNavigate, translate: t, ui }: {
  group: ReturnType<typeof groupBrowserHistory>[number]; query: string;
  history: Pick<ReturnType<typeof useBrowserHistory>, 'removeDay' | 'removeEntry'>;
  onNavigate?: (url: string) => void; translate: BrowserTranslate; ui: SettingsViewUi;
}) {
  const [disclosure, setDisclosure] = useState({ query, expanded: true });
  // New searches reveal matching entries without preventing manual collapse.
  const open = disclosure.query !== query || disclosure.expanded;
  const date = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(group.timestamp);
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const listId = `browser-history-${group.day}`;
  return <section className="browser-settings-page__card browser-history-page__day">
    <header className="browser-history-page__header">
      <ui.Button variant="ghost" className="browser-history-page__date" aria-expanded={open} aria-controls={listId} onClick={() => setDisclosure({ query, expanded: !open })}>
        <span>{date}</span>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </ui.Button>
      <ui.ActionMenu label={`${t('feature.browser.settings.actions')} ${date}`} items={[
        { id: 'delete', label: t('feature.browser.records.deleteDay'), danger: true, icon: <Trash2 size={14} /> },
      ]} onSelect={() => history.removeDay(group.day)} />
    </header>
    {open ? <ul className="browser-history-page__entries" id={listId}>{group.entries.map((item) => <li key={item.url}>
      <ui.Button variant="ghost" className="browser-history-page__link" title={item.url}
        aria-label={`${t('feature.browser.historyOpen')} ${item.title}`} disabled={!onNavigate} onClick={() => onNavigate?.(item.url)}>
        <Globe size={14} aria-hidden="true" />
        <span className="browser-history-page__title">{item.title}</span>
        <span className="browser-history-page__hostname">{new URL(item.url).hostname}</span>
      </ui.Button>
      <time dateTime={new Date(item.visitedAt).toISOString()}>{timeFormat.format(item.visitedAt)}</time>
      <ui.ActionMenu label={`${t('feature.browser.settings.actions')} ${item.title}`} items={[
        { id: 'delete', label: t('feature.browser.settings.remove'), danger: true, icon: <Trash2 size={14} /> },
      ]} onSelect={() => history.removeEntry(item.url)} />
    </li>)}</ul> : null}
  </section>;
}
