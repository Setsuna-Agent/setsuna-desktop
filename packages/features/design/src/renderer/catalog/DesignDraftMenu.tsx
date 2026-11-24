import { ChevronDown, Frame, Plus } from 'lucide-react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown } from '@setsuna-desktop/renderer-ui';
import type { DesignDocumentRef } from '../../contracts/index.js';
import { designFileParts } from './DesignWorkspaceHome.js';

export function DesignDraftMenu({ drafts, selected, documentRef, creating, onCreate, onOpen, translate: t }: Readonly<{
  drafts: ReadonlyMap<string, DesignDocumentRef>;
  selected: string;
  documentRef: DesignDocumentRef | null;
  creating: boolean;
  onCreate(): void;
  onOpen(ref: DesignDocumentRef): void;
  translate: RendererTranslate;
}>) {
  const documentsLabel = t('feature.design.documents');
  const icon = <Frame size={15} aria-hidden="true" />;
  return <Dropdown placement="bottomLeft" menu={{ selectedKeys: selected ? [selected] : undefined, items: [
    { key: 'create', label: t('feature.design.newDraft'), icon: <Plus size={15} aria-hidden="true" />, disabled: creating, onClick: onCreate },
    drafts.size > 0 ? { key: 'divider', type: 'divider' } : null,
    ...[...drafts].map(([key, ref]) => {
      const { name, folder } = designFileParts(ref.path);
      return { key, label: folder ? `${folder}/${name}` : name, icon, onClick: () => { if (key !== selected) onOpen(ref); } };
    }),
  ] }}>
    <button type="button" className="design-workspace__current-file sd-field sd-select-field sd-select-field--with-icon"
      aria-label={documentsLabel} aria-busy={creating || undefined} title={documentRef?.path}>
      <span className="sd-select-field__icon">{icon}</span>
      <span className="sd-select-field__value">{documentRef ? designFileParts(documentRef.path).name : documentsLabel}</span>
      <ChevronDown className="sd-select-field__chevron" size={15} aria-hidden="true" />
    </button>
  </Dropdown>;
}
