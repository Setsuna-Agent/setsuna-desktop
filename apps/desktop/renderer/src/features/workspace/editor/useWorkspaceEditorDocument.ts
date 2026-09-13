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
  const receivedDocument = useRef({ content, itemId, language });
  const pendingEdits = useRef<string[]>([]);
  const [items, setItems] = useState<readonly CodeViewItem<undefined>[]>(() => [{
    id: itemId, type: 'file', edit: true, version: 0,
    file: { cacheKey: `${itemId}:${file.revision ?? 'unknown'}:0`, contents: content, name: file.path, ...(language ? { lang: language } : {}) },
  }]);
  useEffect(() => {
    const previous = receivedDocument.current;
    const sameDocument = previous.itemId === itemId && previous.language === language;
    receivedDocument.current = { content, itemId, language };
    // Native input may advance before React commits an earlier draft. Acknowledge
    // all edits through that echo; comparing only the latest text resets the editor
    // during fast typing. Discard acknowledged entries so future external edits work.
    const echoIndex = sameDocument ? pendingEdits.current.lastIndexOf(content) : -1;
    if (echoIndex !== -1) {
      pendingEdits.current.splice(0, echoIndex + 1);
      return;
    }
    if (sameDocument && previous.content === content) return;
    pendingEdits.current = [];
    // Publish a new CodeView version only for incoming document changes. Echoes of
    // typing or saving keep the live item, caret, and undo history intact.
    setItems((current) => {
      const version = (current[0]?.version ?? 0) + 1;
      return [{ id: itemId, type: 'file', edit: true, version,
        file: { cacheKey: `${itemId}:${file.revision ?? 'unknown'}:${version}`, contents: content, name: file.path, ...(language ? { lang: language } : {}) },
      }];
    });
  }, [content, file.path, file.revision, itemId, language]);

  const onEditorChange = useCallback((_item: CodeViewItem<undefined>, nextFile: FileContents) => {
    pendingEdits.current.push(nextFile.contents);
    onChange(nextFile.contents);
  }, [onChange]);
  return { items, onEditorChange };
}
