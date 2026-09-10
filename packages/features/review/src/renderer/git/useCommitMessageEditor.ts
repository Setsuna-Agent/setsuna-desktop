import { useCallback, useEffect, useRef, useState } from 'react';
import { readCommitMessageDocument, type CommitMessageDocument } from './commit-message-document.js';

export type CommitMessageEditorLauncher = (events: { onClose(): void; onCancel(): void }) => () => void;
type EditorSession = { document: CommitMessageDocument; workspaceKey: string; resolve(message: string | null): void; dispose(): void };

/** The draft outlives the visible tab; explicit save or tab close accepts its latest text once. */
export function useCommitMessageEditor(workspaceKey: string, launch?: CommitMessageEditorLauncher) {
  const session = useRef<EditorSession | null>(null);
  const currentWorkspace = useRef(workspaceKey);
  currentWorkspace.current = workspaceKey;
  const [document, setDocument] = useState<CommitMessageDocument | null>(null);
  const finish = useCallback((accepted: boolean, expected = session.current) => {
    const current = session.current;
    if (!current || current !== expected) return;
    session.current = null;
    setDocument(null);
    current.dispose();
    current.resolve(accepted && current.workspaceKey === currentWorkspace.current ? readCommitMessageDocument(current.document) || null : null);
  }, []);
  useEffect(() => () => { finish(false); }, [finish, workspaceKey]);

  const edit = (initialDocument: CommitMessageDocument): Promise<string | null> => {
    if (!launch || session.current) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const current: EditorSession = { document: initialDocument, workspaceKey, resolve, dispose: () => undefined };
      session.current = current;
      setDocument(initialDocument);
      try {
        const dispose = launch({ onClose: () => finish(true, current), onCancel: () => finish(false, current) });
        if (session.current === current) current.dispose = dispose; else dispose();
      } catch (error) {
        session.current = null;
        setDocument(null);
        reject(error);
      }
    });
  };

  return {
    edit,
    available: Boolean(launch),
    editor: document === null || session.current?.workspaceKey !== workspaceKey ? null : {
      message: document.text,
      canSave: Boolean(readCommitMessageDocument(document)),
      setMessage(value: string) {
        if (!session.current) return;
        // Close handlers may run before React renders the most recent keystroke.
        session.current.document = { ...session.current.document, text: value };
        setDocument(session.current.document);
      },
      cancel: () => finish(false),
      save: () => finish(true),
    },
  };
}
