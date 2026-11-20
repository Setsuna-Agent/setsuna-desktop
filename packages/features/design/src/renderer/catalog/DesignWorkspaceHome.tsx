import { Frame } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { DesignDocumentRef } from '../../contracts/index.js';

export type DesignCatalogFile = Readonly<{ pathKey: string; ref: DesignDocumentRef; source: readonly string[] }>;

export function DesignWorkspaceHome({
  scopeControls, createAction, files, onOpen, renderFileAction, translate: t,
}: Readonly<{
  scopeControls: ReactNode;
  createAction: ReactNode;
  files: readonly DesignCatalogFile[];
  onOpen(ref: DesignDocumentRef): void;
  renderFileAction(ref: DesignDocumentRef): ReactNode;
  translate: RendererTranslate;
}>) {
  return <main className="design-workspace-home">
    <div className="design-workspace-home__content">
      <header className="design-workspace-home__header">
        <h1>{t('feature.design.workspace')}</h1>
        <div className="design-workspace-home__actions">
          {scopeControls}
          {createAction}
        </div>
      </header>
      {files.length > 0 ? (
        <section aria-label={t('feature.design.documents')}>
          <ul className="design-workspace-home__files">
            {files.map(({ pathKey, ref, source }) => {
              const { name, folder } = designFileParts(ref.path);
              const label = [...source, ref.path].join(' / ');
              return <li key={pathKey}>
                <Button variant="ghost" className="design-workspace-home__file" title={label} aria-label={label} onClick={() => onOpen(ref)}>
                  <span className="design-workspace-home__file-icon" aria-hidden="true"><Frame size={20} strokeWidth={1.55} /></span>
                  <span className="design-workspace-home__file-label">
                    <strong>{name}</strong><span>{(folder ? [...source, folder] : source).join(' / ')}</span>
                  </span>
                </Button>
                {renderFileAction(ref)}
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
