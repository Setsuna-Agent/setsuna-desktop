import { Button, Dialog } from '@setsuna-desktop/renderer-ui';
import { useState, type MouseEvent } from 'react';
import { author, license, version } from '../../../../../../package.json';
import appIcon from '../../../../../../assets/build/icon.png';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { getDesktopPlatform } from '../../shared/lib/desktopPlatform.js';
import '../styles/about.css';

const repositoryUrl = 'https://github.com/Setsuna-Agent/setsuna-desktop';
const platformNames: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [linkError, setLinkError] = useState(false);
  const platform = platformNames[getDesktopPlatform()] ?? t('shell.about.browser');
  const links = [
    { label: 'GitHub', url: repositoryUrl },
    { label: t('shell.about.releaseNotes'), url: `${repositoryUrl}/releases` },
    { label: t('shell.about.feedback'), url: `${repositoryUrl}/issues` },
  ];
  const openLink = async (event: MouseEvent<HTMLAnchorElement>) => {
    const bridge = window.setsunaDesktop?.links;
    if (!bridge) return;
    event.preventDefault();
    const url = event.currentTarget.href;
    setLinkError(false);
    try {
      setLinkError(!await bridge.openExternal(url));
    } catch {
      setLinkError(true);
    }
  };

  return (
    <Dialog
      aria-label={t('shell.menu.about')}
      className="app-about-dialog"
      width={440}
      onClose={onClose}
      footer={(
        <>
          <nav className="app-about__links" aria-label={t('shell.about.resources')}>
            {links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" onClick={(event) => void openLink(event)}>
                {link.label}
              </a>
            ))}
          </nav>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </>
      )}
    >
      <div className="app-about__identity">
        <img className="app-about__icon" src={appIcon} alt="Setsuna Desktop" width={64} height={64} />
        <div>
          <h1>Setsuna Desktop</h1>
          <p className="app-about__description">{t('shell.about.description')}</p>
        </div>
      </div>
      <dl className="app-about__details">
        <div><dt>{t('shell.about.version')}</dt><dd className="app-about__version">v{version}</dd></div>
        <div><dt>{t('shell.about.platform')}</dt><dd>{platform}</dd></div>
        <div><dt>{t('shell.about.developer')}</dt><dd>{author.name}</dd></div>
        <div><dt>{t('shell.about.license')}</dt><dd>{license}</dd></div>
      </dl>
      {linkError ? <p className="app-about__error" role="alert">{t('shell.about.linkError')}</p> : null}
    </Dialog>
  );
}
