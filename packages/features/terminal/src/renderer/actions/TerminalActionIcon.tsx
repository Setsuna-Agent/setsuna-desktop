import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton, Popover, Tooltip } from '@setsuna-desktop/renderer-ui';
import {
  Brush, Bug, Check, Cloud, Code2, Database, Download, FileCode2, FlaskConical, Folder,
  GitBranch, GitPullRequest, Globe, Hammer, Package, Play, RefreshCw, Rocket, Server,
  Settings, ShieldCheck, SquareTerminal, Upload, Zap, type LucideIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { TERMINAL_ACTION_ICONS, type TerminalActionIcon as ActionIcon } from '../../contracts/index.js';

const icons = {
  settings: Settings, play: Play, bug: Bug, flask: FlaskConical, terminal: SquareTerminal, code: Code2,
  build: Hammer, package: Package, rocket: Rocket, server: Server, database: Database, globe: Globe,
  cloud: Cloud, 'git-branch': GitBranch, 'git-pull-request': GitPullRequest, folder: Folder,
  'file-code': FileCode2, download: Download, upload: Upload, refresh: RefreshCw, brush: Brush,
  shield: ShieldCheck, check: Check, zap: Zap,
} satisfies Record<ActionIcon, LucideIcon>;

export function TerminalActionIcon({ icon, size = 16 }: { icon: ActionIcon; size?: number }) {
  const Icon = icons[icon];
  return <Icon size={size} aria-hidden="true" />;
}

export function TerminalActionIconPicker({ value, onChange, translate: t }: {
  value: ActionIcon;
  onChange(icon: ActionIcon): void;
  translate: RendererTranslate;
}) {
  const [open, setOpen] = useState(false);
  const selected = useRef<HTMLButtonElement>(null);
  return <Popover placement="bottomLeft" modal open={open} onOpenChange={setOpen}
    className="feature-terminal-action-icon-picker" contentLabel={t('feature.terminal.actions.chooseIcon')}
    onOpenAutoFocus={(event) => { event.preventDefault(); selected.current?.focus(); }}
    content={<div className="feature-terminal-action-icon-picker__grid" role="group" aria-label={t('feature.terminal.actions.chooseIcon')}>
      {TERMINAL_ACTION_ICONS.map((icon) => <Tooltip key={icon} title={t(`feature.terminal.actions.icon.${icon}`)}>
        <IconButton ref={icon === value ? selected : undefined} label={t(`feature.terminal.actions.icon.${icon}`)} title=""
          className="feature-terminal-action-icon-picker__choice" aria-pressed={icon === value}
          onClick={() => { onChange(icon); setOpen(false); }}>
          <TerminalActionIcon icon={icon} />
        </IconButton>
      </Tooltip>)}
    </div>}>
    <IconButton className="feature-terminal-action__icon" label={t('feature.terminal.actions.chooseIcon')}>
      <TerminalActionIcon icon={value} />
    </IconButton>
  </Popover>;
}
