import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import type { CodeViewItem, FileContents } from '@pierre/diffs/react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useWorkspaceEditorDocument({ content, file, language, onChange }: {
  content: string;
  file: Pick<WorkspaceFileRead, 'projectId' | 'path' | 'revision'>;
  language?: string;
  onChange(content: string): void;
}) {
  const itemId = `${file.projectId}:${file.path}`;
  const liveContent = useRef(content);
  const [items, setItems] = useState<readonly CodeViewItem<undefined>[]>(() => [{
    id: itemId, type: 'file', edit: true, version: 0,
    file: { cacheKey: `${itemId}:${file.revision ?? 'unknown'}:0`, contents: content, name: file.path, ...(language ? { lang: language } : {}) },
  }]);
  const currentItem = items[0];
  useEffect(() => {
    const currentLanguage = currentItem?.type === 'file' ? currentItem.file.lang : undefined;
    if (content === liveContent.current && currentItem?.id === itemId && currentLanguage === language) return;
    liveContent.current = content;
    // Publish a new CodeView version only for incoming document changes. Echoes of
    // typing or saving keep the live item, caret, and undo history intact.
    setItems((current) => {
      const version = (current[0]?.version ?? 0) + 1;
      return [{ id: itemId, type: 'file', edit: true, version,
        file: { cacheKey: `${itemId}:${file.revision ?? 'unknown'}:${version}`, contents: content, name: file.path, ...(language ? { lang: language } : {}) },
      }];
    });
  }, [content, currentItem, file.path, file.revision, itemId, language]);

  const onEditorChange = useCallback((_item: CodeViewItem<undefined>, nextFile: FileContents) => {
    liveContent.current = nextFile.contents;
    onChange(nextFile.contents);
  }, [onChange]);
  return { items, onEditorChange };
}
