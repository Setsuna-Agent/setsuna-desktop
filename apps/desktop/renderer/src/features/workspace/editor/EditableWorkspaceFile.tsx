import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { Editor, type EditorOptions } from '@pierre/diffs/edit';
import {
  CodeView,
  EditProvider,
  type CodeViewHandle,
} from '@pierre/diffs/react';
import { useCallback, useMemo, useRef, type KeyboardEvent } from 'react';
import {
  pierreSurfaceStyle,
  useCodeViewLineFocus,
  usePierreFileOptions,
} from '../../../shared/code/PierreCode.js';
import type { WorkspaceFileFocusRequest } from '../model.js';
import {
  useWorkspaceCodeViewSurface,
  workspaceCodeViewLayout,
  workspaceCodeViewUnsafeCSS,
} from './useWorkspaceCodeViewSurface.js';
import { WorkspaceCodeViewScrollbar } from './WorkspaceCodeViewScrollbar.js';
import { useWorkspaceEditorDocument } from './useWorkspaceEditorDocument.js';

type EditableWorkspaceFileProps = {
  active?: boolean;
  content: string;
  file: Pick<WorkspaceFileRead, 'projectId' | 'path' | 'revision'>;
  fileFocusRequest?: WorkspaceFileFocusRequest;
  language?: string;
  onChange: (content: string) => void;
  onSave: () => Promise<boolean>;
};

export function EditableWorkspaceFile({
  active = true,
  content,
  file,
  fileFocusRequest,
  language,
  onChange,
  onSave,
}: EditableWorkspaceFileProps) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
  const codeViewSurface = useWorkspaceCodeViewSurface();
  const options = usePierreFileOptions({
    layout: workspaceCodeViewLayout,
    unsafeCSS: workspaceCodeViewUnsafeCSS,
  });
  const itemId = `${file.projectId}:${file.path}`;
  const { items, onEditorChange } = useWorkspaceEditorDocument({ content, file, language, onChange });
  const editorOptions = useMemo<Omit<EditorOptions<undefined>, 'onChange'>>(() => ({
    onAttach: (editor) => {
      window.requestAnimationFrame(() => {
        // Loading the editor can finish after the user has switched to Markdown preview.
        if (activeRef.current) editor.focus({ lineNumber: fileFocusRequest?.line ?? 'first-visible' });
      });
    },
  }), [fileFocusRequest?.line]);
  const createEditor = useCallback((creationOptions: EditorOptions<undefined>) => new Editor({
    ...creationOptions,
    historyMaxEntries: 200,
    matchBrackets: true,
  }), []);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void onSave();
  };
  useCodeViewLineFocus(codeViewRef, itemId, fileFocusRequest);

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
            onItemEditChange={onEditorChange}
            options={options}
            ref={codeViewRef}
            style={pierreSurfaceStyle}
          />
        </EditProvider>
        <WorkspaceCodeViewScrollbar surface={codeViewSurface} />
      </div>
    </div>
  );
}
