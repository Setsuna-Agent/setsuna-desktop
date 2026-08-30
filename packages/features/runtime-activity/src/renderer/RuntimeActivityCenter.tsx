import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsButtonProps,
  SettingsIconButtonProps,
} from '@setsuna-desktop/renderer-contracts/settings';
import { CircleAlert, Gauge, LoaderCircle, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  RuntimeActiveTaskRows,
  RuntimeBackgroundServiceRows,
} from './RuntimeActivityRows.js';
import { resolveRuntimeActivityLoadView } from './runtime-activity-model.js';
import {
  useRuntimeActivitySnapshot,
} from './use-runtime-activity-snapshot.js';
import type { RuntimeActivityRendererService } from '../contracts/index.js';
import './runtime-activity.css';

type RuntimeActivityTab = 'tasks' | 'services';

export type RuntimeActivityUi = Readonly<{
  Button: ComponentType<SettingsButtonProps>;
  IconButton: ComponentType<SettingsIconButtonProps>;
}>;

export type RuntimeActivityCenterProps = Readonly<{
  onActivitiesChanged?: () => unknown;
  onClose: () => void;
  onOpenThread: (threadId: string) => void | Promise<void>;
  projects: readonly Readonly<{ id: string; name: string }>[];
  returnFocusRef: RefObject<HTMLButtonElement>;
  service: RuntimeActivityRendererService;
  translate: RendererTranslate;
  ui: RuntimeActivityUi;
}>;

export function RuntimeActivityCenter({
  onActivitiesChanged,
  onClose,
  onOpenThread,
  projects,
  returnFocusRef,
  service,
  translate: t,
  ui: { Button, IconButton },
}: RuntimeActivityCenterProps) {
  const [activeTab, setActiveTab] = useState<RuntimeActivityTab>('tasks');
  const dialogRef = useRef<HTMLElement | null>(null);
  const nowMs = useRuntimeActivityClock();
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const {
    error,
    loading,
    refresh,
    snapshot,
    stoppingKeys,
    stopService,
    stopTask,
  } = useRuntimeActivitySnapshot({ service, onActivitiesChanged });
  const tasks = snapshot?.tasks ?? [];
  const services = snapshot?.backgroundServices ?? [];
  const loadView = resolveRuntimeActivityLoadView({
    error,
    hasSnapshot: snapshot !== null,
    loading,
  });

  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== 'Tab') return;
      trapRuntimeActivityDialogFocus(event, dialogRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeAndRestoreFocus]);

  const openThread = useCallback((threadId: string) => {
    closeAndRestoreFocus();
    void onOpenThread(threadId);
  }, [closeAndRestoreFocus, onOpenThread]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="runtime-activity-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAndRestoreFocus();
      }}
    >
      <section
        aria-labelledby="runtime-activity-title"
        aria-modal="true"
        className="runtime-activity-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="runtime-activity-dialog__header">
          <span className="runtime-activity-dialog__heading-icon" aria-hidden="true">
            <Gauge size={17} />
          </span>
          <span className="runtime-activity-dialog__heading">
            <strong id="runtime-activity-title">{t('feature.runtimeActivity.title')}</strong>
            <small>{t('feature.runtimeActivity.description')}</small>
          </span>
          <IconButton
            className="runtime-activity-dialog__close"
            label={t('feature.runtimeActivity.close')}
            onClick={closeAndRestoreFocus}
          >
            <X size={15} />
          </IconButton>
        </header>

        <div
          className="runtime-activity-tabs"
          role="tablist"
          aria-label={t('feature.runtimeActivity.tabs')}
          onKeyDown={handleRuntimeActivityTabKeyDown}
        >
          <RuntimeActivityTabButton
            active={activeTab === 'tasks'}
            count={tasks.length}
            id="tasks"
            label={t('feature.runtimeActivity.tasks.title')}
            onSelect={() => setActiveTab('tasks')}
          />
          <RuntimeActivityTabButton
            active={activeTab === 'services'}
            count={services.length}
            id="services"
            label={t('feature.runtimeActivity.services.title')}
            onSelect={() => setActiveTab('services')}
          />
        </div>

        <div
          aria-busy={loading}
          aria-labelledby={`runtime-activity-tab-${activeTab}`}
          className="runtime-activity-dialog__body"
          id={`runtime-activity-panel-${activeTab}`}
          role="tabpanel"
        >
          {loadView === 'loading' ? (
            <div className="runtime-activity-empty">
              <LoaderCircle className="is-spinning" size={18} />
              <span>{t('feature.runtimeActivity.loading')}</span>
            </div>
          ) : loadView === 'error' ? (
            <div className="runtime-activity-empty runtime-activity-empty--error" role="alert">
              <CircleAlert size={20} aria-hidden="true" />
              <strong>{t('feature.runtimeActivity.loadFailed')}</strong>
              <span>{t('feature.runtimeActivity.refreshFailed', { error: error ?? '' })}</span>
              <Button variant="ghost" onClick={() => void refresh(true)}>
                {t('feature.runtimeActivity.retry')}
              </Button>
            </div>
          ) : activeTab === 'tasks' && tasks.length ? (
            <RuntimeActiveTaskRows
              nowMs={nowMs}
              onOpenThread={openThread}
              onStopTask={stopTask}
              projectNameById={projectNameById}
              stoppingKeys={stoppingKeys}
              tasks={tasks}
              translate={t}
            />
          ) : activeTab === 'services' && services.length ? (
            <RuntimeBackgroundServiceRows
              nowMs={nowMs}
              onOpenThread={openThread}
              onStopService={stopService}
              projectNameById={projectNameById}
              services={services}
              stoppingKeys={stoppingKeys}
              translate={t}
            />
          ) : (
            <div className="runtime-activity-empty">
              <Gauge size={20} aria-hidden="true" />
              <strong>{t(activeTab === 'tasks' ? 'feature.runtimeActivity.tasks.empty' : 'feature.runtimeActivity.services.empty')}</strong>
              <span>{t(activeTab === 'tasks' ? 'feature.runtimeActivity.tasks.emptyDescription' : 'feature.runtimeActivity.services.emptyDescription')}</span>
            </div>
          )}
        </div>

        {error && snapshot ? (
          <footer className="runtime-activity-dialog__footer">
            <span className="runtime-activity-dialog__status" role="status" title={error}>
              {t('feature.runtimeActivity.refreshFailed', { error })}
            </span>
            <Button variant="ghost" onClick={() => void refresh(true)}>
              {t('feature.runtimeActivity.retry')}
            </Button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function RuntimeActivityTabButton({
  active,
  count,
  id,
  label,
  onSelect,
}: {
  active: boolean;
  count: number;
  id: RuntimeActivityTab;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-controls={`runtime-activity-panel-${id}`}
      aria-selected={active}
      className={active ? 'is-active' : undefined}
      id={`runtime-activity-tab-${id}`}
      role="tab"
      tabIndex={active ? 0 : -1}
      type="button"
      onClick={onSelect}
    >
      <span>{label}</span>
      {count > 0 ? <span className="runtime-activity-tabs__count">{count}</span> : null}
    </button>
  );
}

function handleRuntimeActivityTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (!tabs.length) return;
  const currentIndex = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function useRuntimeActivityClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);
  return nowMs;
}

function trapRuntimeActivityDialogFocus(event: KeyboardEvent, dialog: HTMLElement | null): void {
  if (!dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((item) => item.offsetParent !== null || item === document.activeElement);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
