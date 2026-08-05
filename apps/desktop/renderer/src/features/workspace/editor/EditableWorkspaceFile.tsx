import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { Editor, type EditorOptions } from '@pierre/diffs/edit';
import {
  CodeView,
  EditProvider,
  type CodeViewItem,
  type FileContents,
} from '@pierre/diffs/react';
import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import {
  pierreSurfaceStyle,
  usePierreFileOptions,
} from '../../../shared/code/PierreCode.js';
import {
  useWorkspaceCodeViewSurface,
  workspaceCodeViewLayout,
  workspaceCodeViewUnsafeCSS,
} from './useWorkspaceCodeViewSurface.js';
import { WorkspaceCodeViewScrollbar } from './WorkspaceCodeViewScrollbar.js';

type EditableWorkspaceFileProps = {
  content: string;
  file: WorkspaceFileRead;
  onChange: (content: string) => void;
  onSave: () => Promise<boolean>;
};

export function EditableWorkspaceFile({
  content,
  file,
  onChange,
  onSave,
}: EditableWorkspaceFileProps) {
  const codeViewSurface = useWorkspaceCodeViewSurface();
  const options = usePierreFileOptions({
    layout: workspaceCodeViewLayout,
    unsafeCSS: workspaceCodeViewUnsafeCSS,
  });
  // CodeView owns the live editor document. Keep its controlled item stable
  // while parent state receives changes, otherwise each keystroke reconciles
  // and replaces the virtualized file.
  const [items] = useState<readonly CodeViewItem<undefined>[]>(() => [{
    id: `${file.projectId}:${file.path}`,
    type: 'file',
    edit: true,
    file: {
      cacheKey: `${file.projectId}:${file.path}:${file.revision ?? 'unknown'}`,
      contents: content,
      name: file.path,
    },
  }]);
  const editorOptions = useMemo<Omit<EditorOptions<undefined>, 'onChange'>>(() => ({
    onAttach: (editor) => {
      window.requestAnimationFrame(() => editor.focus({ lineNumber: 'first-visible' }));
    },
  }), []);
  const createEditor = useCallback((creationOptions: EditorOptions<undefined>) => new Editor({
    ...creationOptions,
    historyMaxEntries: 200,
    matchBrackets: true,
  }), []);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    void onSave();
  };
  const handleEditorChange = useCallback((
    _item: CodeViewItem<undefined>,
    nextFile: FileContents,
  ) => onChange(nextFile.contents), [onChange]);

  return (
    <div
      className="desktop-code-editor desktop-code-editor--code-view"
      onKeyDown={handleKeyDown}
    >
      <div className="desktop-code-editor__viewport">
        <EditProvider createEditor={createEditor}>
          <CodeView
            className="setsuna-pierre-surface desktop-code-editor__pierre"
            containerRef={codeViewSurface.codeViewContainerRef}
            disableWorkerPool
            editorOptions={editorOptions}
            items={items}
            onItemEditChange={handleEditorChange}
            options={options}
            style={pierreSurfaceStyle}
          />
        </EditProvider>
        <WorkspaceCodeViewScrollbar surface={codeViewSurface} />
      </div>
    </div>
  );
}
