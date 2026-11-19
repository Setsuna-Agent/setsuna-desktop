import { ArrowUpRight, Frame, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button } from '@setsuna-desktop/renderer-ui';

export function DesignWorkspaceHome({
  scopeControls, createLabel, paths, onCreate, onOpen, translate: t,
}: Readonly<{
  scopeControls: ReactNode;
  createLabel: string;
  paths: readonly string[];
  onCreate(): void;
  onOpen(path: string): void;
  translate: RendererTranslate;
}>) {
  return <main className="design-workspace-home">
    <div className="design-workspace-home__content">
      <header className="design-workspace-home__hero">
        <div className="design-workspace-home__intro">
          <h1>{t('feature.design.workspace')}</h1>
          {scopeControls}
          <Button variant="primary" className="design-workspace-home__create" icon={<Plus size={17} />} onClick={onCreate}>
            {createLabel}
          </Button>
        </div>
        <div className="design-workspace-home__art" aria-hidden="true">
          <div className="design-workspace-home__paper">
            <span className="design-workspace-home__paper-bar" />
            <span className="design-workspace-home__paper-selection">
              <span /><span /><span /><span />
            </span>
            <span className="design-workspace-home__paper-lines" />
          </div>
          <div className="design-workspace-home__phone">
            <span /><span /><span />
          </div>
        </div>
      </header>
      {paths.length > 0 ? (
        <section className="design-workspace-home__library" aria-label={t('feature.design.documents')}>
          <h2>{t('feature.design.documents')}</h2>
          <ul className="design-workspace-home__files">
            {paths.map((path) => {
              const { name, folder } = designFileParts(path);
              return <li key={path}>
                <Button variant="ghost" className="design-workspace-home__file" title={path} aria-label={path} onClick={() => onOpen(path)}>
                  <span className="design-workspace-home__file-icon" aria-hidden="true"><Frame size={20} strokeWidth={1.55} /></span>
                  <span className="design-workspace-home__file-label"><strong>{name}</strong>{folder ? <span>{folder}</span> : null}</span>
                  <ArrowUpRight className="design-workspace-home__file-arrow" size={15} aria-hidden="true" />
                </Button>
              </li>;
            })}
          </ul>
        </section>
      ) : null}
    </div>
  </main>;
}

export function designFileParts(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/');
  const fileName = path.slice(slash + 1);
  return { name: fileName.replace(/\.design\.json$/iu, '') || fileName, folder: slash === -1 ? '' : path.slice(0, slash) };
}
