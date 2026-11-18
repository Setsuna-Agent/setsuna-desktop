import { Circle, Frame, Hand, ImageIcon, MousePointer2, Pentagon, PenTool, Shapes, Square, Type } from 'lucide-react';
import { Fragment } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import type { DesignTool } from './use-design-canvas-gestures.js';

const tools = [
  { id: 'select', icon: MousePointer2, shortcut: 'V' },
  { id: 'hand', icon: Hand, shortcut: 'H' },
  { id: 'frame', icon: Frame, shortcut: 'F' },
  { id: 'rectangle', icon: Square, shortcut: 'R' },
  { id: 'ellipse', icon: Circle, shortcut: 'O' },
  { id: 'polygon', icon: Pentagon, shortcut: 'G' },
  { id: 'pen', icon: PenTool, shortcut: 'P' },
  { id: 'text', icon: Type, shortcut: 'T' },
] as const;

export function designToolForKey(key: string): DesignTool | undefined {
  return tools.find((tool) => tool.shortcut.toLowerCase() === key)?.id;
}

export function DesignTools({ tool, disabled, onChange, onImage, onIcon, translate: t }: Readonly<{
  tool: DesignTool;
  disabled: boolean;
  onChange(tool: DesignTool): void;
  onImage(): void;
  onIcon(): void;
  translate: RendererTranslate;
}>) {
  return <div className="design-tools" role="toolbar" aria-label={t('feature.design.tools')}>
    {tools.map(({ id, icon: Icon, shortcut }) => <Fragment key={id}>
      {id === 'frame' ? <span className="design-tools__divider" aria-hidden="true" /> : null}
      <IconButton size="small" label={t(`feature.design.tool.${id}`)} title={`${t(`feature.design.tool.${id}`)} (${shortcut})`}
        aria-pressed={tool === id} aria-keyshortcuts={shortcut} disabled={disabled} onClick={() => onChange(id)}>
        <Icon size={17} strokeWidth={1.8} />
      </IconButton>
    </Fragment>)}
    <span className="design-tools__divider" aria-hidden="true" />
    <IconButton size="small" label={t('feature.design.addImage')} disabled={disabled} onClick={onImage}><ImageIcon size={17} strokeWidth={1.8} /></IconButton>
    <IconButton size="small" label={t('feature.design.addIcon')} disabled={disabled} onClick={onIcon}><Shapes size={17} strokeWidth={1.8} /></IconButton>
  </div>;
}
