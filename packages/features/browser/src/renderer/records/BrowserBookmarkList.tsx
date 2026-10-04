import { useMemo } from 'react';
import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { ChevronDown, ChevronRight, Folder, Globe, Pencil, Star, Trash2 } from 'lucide-react';
import type { BrowserBookmarkNode, BrowserBookmarkTree } from '../../contracts/bookmarks.js';
import type { BrowserTranslate } from '../messages.js';
import { bookmarkNodeTitle } from './bookmarkLabels.js';
import { bookmarkDescendants } from './bookmarkTree.js';

export function BrowserBookmarkList({ tree, query, expanded, selected, onToggleFolder, onOpen, onEdit, onRemove, translate: t }: {
  tree: BrowserBookmarkTree; query: string; expanded: ReadonlySet<string>; selected: string;
  onToggleFolder(id: string): void; onOpen?: (url: string) => void;
  onEdit(node: BrowserBookmarkNode): void; onRemove(node: BrowserBookmarkNode): void; translate: BrowserTranslate;
}) {
  const { children, visible } = useMemo(() => {
    const children = new Map<string | null, BrowserBookmarkNode[]>();
    const byId = new Map(tree.nodes.map((node) => [node.id, node]));
    const visible = new Set<string>();
    const search = query.trim().toLowerCase();
    for (const node of tree.nodes) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
      if (!search) { visible.add(node.id); continue; }
      const matches = `${bookmarkNodeTitle(node, t)} ${node.type === 'bookmark' ? node.url : ''}`.toLowerCase().includes(search);
      if (!matches) continue;
      for (const id of node.type === 'folder' ? bookmarkDescendants(tree, node.id) : [node.id]) visible.add(id);
      let parentId = node.parentId;
      while (parentId) { visible.add(parentId); parentId = byId.get(parentId)?.parentId ?? null; }
    }
    return { children, visible };
  }, [tree, query, t]);
  const searching = Boolean(query.trim());
  const rows = (parentId: string | null) => <ul className="browser-records__tree">{(children.get(parentId) ?? []).filter((node) => visible.has(node.id)).map((node) => {
    const title = bookmarkNodeTitle(node, t);
    const isFolder = node.type === 'folder';
    const open = isFolder && (searching || expanded.has(node.id));
    return <li key={node.id}>
      <div className={`browser-records__tree-row${selected === node.id ? ' is-selected' : ''}`}>
        <Button variant="ghost" className="browser-records__link" disabled={!isFolder && !onOpen}
          title={node.type === 'bookmark' ? node.url : title} aria-expanded={isFolder ? open : undefined}
          aria-label={isFolder ? title : `${t('feature.browser.historyOpen')} ${title}`}
          onClick={() => isFolder ? onToggleFolder(node.id) : onOpen?.(node.url)}>
          <span className="browser-records__disclosure" aria-hidden="true">{isFolder ? open ? <ChevronDown size={10} /> : <ChevronRight size={10} /> : null}</span>
          <span className="browser-records__item-icon" aria-hidden="true">
            {isFolder ? node.root === 'bar' ? <Star size={14} /> : <Folder size={14} /> : <Globe size={14} />}
          </span>
          <span className="browser-records__title">{title}</span>
        </Button>
        {!(node.type === 'folder' && node.root) ? <span className="browser-records__row-action">
          <IconButton label={`${t('feature.browser.settings.edit')} ${title}`} onClick={() => onEdit(node)}><Pencil size={12} /></IconButton>
          <IconButton label={`${t('feature.browser.settings.remove')} ${title}`} onClick={() => onRemove(node)}><Trash2 size={12} /></IconButton>
        </span> : null}
      </div>
      {open ? rows(node.id) : null}
    </li>;
  })}</ul>;
  return <div className="browser-records__scroll">{visible.size ? rows(null) : <div className="browser-records__empty">{t('feature.browser.settings.empty')}</div>}</div>;
}
