import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
  createNoopReviewRendererService,
  type ReviewRendererService,
  type GitConflictTaskRecord,
} from '../contracts/index.js';

export type { GitConflictTaskRecord } from '../contracts/index.js';

const GitConflictTasksContext = createContext<{
  tasks: ReadonlyMap<string, readonly GitConflictTaskRecord[]>;
  recordTasks: (workspaceRoot: string, tasks: readonly GitConflictTaskRecord[]) => void;
  updateTask: (workspaceRoot: string, task: GitConflictTaskRecord) => void;
  removeTask: (turnId: string) => void;
}>({ tasks: new Map(), recordTasks: () => undefined, updateTask: () => undefined, removeTask: () => undefined });

export function useGitConflictTasks() { return useContext(GitConflictTasksContext); }

const ReviewRendererContext = createContext<ReviewRendererService>(
  createNoopReviewRendererService(),
);

export function ReviewRendererProvider({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: ReviewRendererService;
}>) {
  // Cache the runtime's durable history across project/page changes. Merge reads
  // with newly started tasks so an older response cannot erase a live task.
  const [tasks, setTasks] = useState<ReadonlyMap<string, readonly GitConflictTaskRecord[]>>(new Map());
  const removedTurns = useRef(new Set<string>());
  const recordTasks = useCallback((root: string, entries: readonly GitConflictTaskRecord[]) => {
    setTasks((current) => {
      const history = current.get(root) ?? [];
      const known = new Set(history.map((task) => task.turnId));
      const added = entries.filter((task) => !known.has(task.turnId) && !removedTurns.current.has(task.turnId));
      return added.length ? new Map(current).set(root, [...history, ...added]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.threadId.localeCompare(a.threadId))) : current;
    });
  }, []);
  const updateTask = useCallback((root: string, updated: GitConflictTaskRecord) => {
    if (removedTurns.current.has(updated.turnId)) return;
    // Apply confirmed mutations separately: a delayed history read must not undo
    // a completed archive/restore while the panel stays mounted.
    setTasks((current) => {
      const next = new Map(current);
      let found = false;
      // The settings archive uses canonical roots; an open panel may use a path
      // alias. Update all cached copies by task identity, not just by root text.
      for (const [key, history] of current) {
        if (!history.some((task) => task.turnId === updated.turnId)) continue;
        found = true;
        next.set(key, history.map((task) => task.turnId === updated.turnId ? updated : task));
      }
      if (!found) next.set(root, [...(current.get(root) ?? []), updated]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.threadId.localeCompare(a.threadId)));
      return next;
    });
  }, []);
  const removeTask = useCallback((turnId: string) => {
    // A read started before deletion may arrive later; it must not resurrect
    // the deleted record in this provider's cache, including path aliases.
    removedTurns.current.add(turnId);
    setTasks((current) => new Map([...current].map(([root, history]) =>
      [root, history.filter((task) => task.turnId !== turnId)])));
  }, []);
  return (
    <ReviewRendererContext.Provider value={service}>
      <GitConflictTasksContext.Provider value={{ tasks, recordTasks, updateTask, removeTask }}>{children}</GitConflictTasksContext.Provider>
    </ReviewRendererContext.Provider>
  );
}

export function useReviewRendererService(): ReviewRendererService {
  return useContext(ReviewRendererContext);
}
