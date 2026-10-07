import { useBrowserImport } from '../import/useBrowserImport.js';
import type { BrowserSettingsContentProps } from './types.js';
import './import.css';

export function BrowserImportPage({ bridge, translate: t, ui }: BrowserSettingsContentProps) {
  const importer = useBrowserImport(bridge, t);
  const eligible = importer.preview?.extensions.filter((item) => item.compatible && !item.installed) ?? [];
  const disabled = importer.busy || importer.loading;
  return <ui.Section className="browser-import" featureId="browser">
    <ui.Group>
      <ui.Row label={t('feature.browser.import.source')}>
        <ui.SelectField className="browser-import__source" aria-label={t('feature.browser.import.source')} value={importer.profileId}
          disabled={disabled || !importer.profiles.length} onValueChange={importer.selectProfile}>
          {!importer.profiles.length ? <option value="">{t(importer.loading ? 'feature.browser.settings.loading' : 'feature.browser.import.noProfiles')}</option> : null}
          {importer.profiles.map((profile) => <option key={profile.id} value={profile.id}>
            {profile.browser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'} · {profile.name}
          </option>)}
        </ui.SelectField>
      </ui.Row>
      <ui.Row label={t('feature.browser.settings.bookmarks')}>
        <ui.Checkbox aria-label={t('feature.browser.settings.bookmarks')} checked={importer.favorites}
          disabled={disabled || !importer.preview} onChange={importer.setFavorites} />
      </ui.Row>
    </ui.Group>
    {importer.preview ? <ui.Group>
      <ui.Row label={t('feature.browser.extension.label')}>
        <ui.Checkbox aria-label={t('feature.browser.extension.label')} checked={eligible.length > 0 && eligible.every((item) => importer.selected.includes(item.id))}
          indeterminate={importer.selected.length > 0 && importer.selected.length < eligible.length} disabled={disabled || !eligible.length}
          onChange={(checked) => importer.setSelected(checked ? eligible.map((item) => item.id) : [])} />
      </ui.Row>
      {importer.preview.extensions.map((item) => <ui.Row key={item.id} label={item.name}>
        <ui.Checkbox aria-label={item.name} checked={importer.selected.includes(item.id)} disabled={disabled || item.installed || !item.compatible}
          title={item.installed ? t('feature.browser.import.installed') : !item.compatible ? t('feature.browser.import.unsupported') : undefined}
          onChange={(checked) => importer.selectExtension(item.id, checked)} />
      </ui.Row>)}
    </ui.Group> : null}
    <div className="browser-import__actions">
      <ui.Button disabled={disabled} onClick={() => void importer.importHtml()}>{t('feature.browser.import.html')}</ui.Button>
      <ui.Button variant="primary" disabled={disabled || !importer.preview || (!importer.favorites && !importer.selected.length)}
        onClick={() => void importer.importSelected()}>{t(importer.busy ? 'feature.browser.import.importing' : 'feature.browser.import.start')}</ui.Button>
    </div>
    {importer.notice ? <ui.Toast tone={importer.notice.tone} message={importer.notice.message} /> : null}
  </ui.Section>;
}
