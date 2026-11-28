import { Share2 } from 'lucide-react';
import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import { designFileKey } from '../../contracts/operations.js';
import type { DesignPublicationBridge } from '../../contracts/design-publication.js';
import { DesignShareDialog } from './DesignShareDialog.js';
import { useDesignPublication, type DesignPublicationSource } from './use-design-publication.js';

export function DesignPublicationActions({ source, bridge, disabled, translate: t }: Readonly<{
  source: DesignPublicationSource;
  bridge: DesignPublicationBridge;
  disabled: boolean;
  translate: RendererTranslate;
}>) {
  const [sharing, setSharing] = useState(false);
  const { job, exportPackage, publish, cancel } = useDesignPublication(source, bridge, t);
  return <>
    <IconButton size="small" label={t('feature.design.publication.share')} aria-haspopup="dialog" aria-expanded={sharing}
      onClick={() => setSharing(true)}><Share2 size={15} /></IconButton>
    {sharing ? <DesignShareDialog bridge={bridge} documentId={source.documentId} designKey={designFileKey(source.documentRef)}
      disabled={disabled} publishing={job === 'preview'} packaging={job === 'package'} publish={publish} copy={source.client.assets.output.copyText}
      exportPackage={() => { void exportPackage(); }} exportDocument={source.exportDocument}
      onClose={() => { cancel('preview'); setSharing(false); }} translate={t} /> : null}
  </>;
}
