import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Braces, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRendererPluginInspection } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import type {
  RendererSlotCandidateState,
  RendererSlotInspection,
  RendererSlotInspectionCandidate,
  RendererSlotInspectionNode,
} from '../../kernel/renderer-plugins/runtime.js';

type StateFilter = 'all' | RendererSlotCandidateState;

const stateFilters = [
  'all',
  'active',
  'eligible',
  'shadowed',
  'dormant',
  'hidden',
] as const satisfies readonly StateFilter[];

const stateFilterMessageKeys = {
  active: 'feature.rendererInspector.stateActive',
  all: 'feature.rendererInspector.stateAll',
  dormant: 'feature.rendererInspector.stateDormant',
  eligible: 'feature.rendererInspector.stateEligible',
  hidden: 'feature.rendererInspector.stateHidden',
  shadowed: 'feature.rendererInspector.stateShadowed',
} as const satisfies Record<StateFilter, `feature.${string}`>;

export function RendererPluginInspectorSettings({
  translate,
  ui,
}: Readonly<{
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const inspection = useRendererPluginInspection();
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');
  const inspectionDormant = inspection.dormant;
  const inspectionRoots = inspection.roots;
  const filtered = useMemo(
    () => filterRendererPluginInspection({
      dormant: inspectionDormant,
      roots: inspectionRoots,
    }, query, stateFilter),
    [inspectionDormant, inspectionRoots, query, stateFilter],
  );
  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(inspection, null, 2));
      setCopyState('done');
    } catch {
      setCopyState('error');
    }
  };

  return (
    <ui.Section className="renderer-plugin-inspector-section" featureId="core.renderer-inspector">
      <details className="chat-user-settings__section-block chat-user-settings__advanced-disclosure renderer-plugin-inspector">
        <summary className="chat-user-settings__advanced-summary">
          <span className="chat-user-settings__advanced-icon" aria-hidden="true">
            <Braces size={16} />
          </span>
          <span className="chat-user-settings__advanced-copy">
            <strong>{translate('feature.rendererInspector.title')}</strong>
            <small>{translate('feature.rendererInspector.description')}</small>
          </span>
          <span className="chat-user-settings__advanced-toggle" aria-hidden="true">
            <ChevronRight className="chat-user-settings__advanced-chevron" size={15} />
          </span>
        </summary>

        <div className="renderer-plugin-inspector__body">
          <div className="renderer-plugin-inspector__toolbar">
            <ui.TextField
              aria-label={translate('feature.rendererInspector.filter')}
              placeholder={translate('feature.rendererInspector.filter')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ui.SelectField
              aria-label={translate('feature.rendererInspector.state')}
              value={stateFilter}
              valueContent={translate(stateFilterMessageKeys[stateFilter])}
              onValueChange={(value) => setStateFilter(value as StateFilter)}
            >
              {stateFilters.map((state) => (
                <option key={state} value={state}>
                  {translate(stateFilterMessageKeys[state])}
                </option>
              ))}
            </ui.SelectField>
            <ui.Button onClick={() => void copyDiagnostics()}>
              {translate('feature.rendererInspector.copy')}
            </ui.Button>
          </div>

          {copyState === 'done' ? <ui.Toast message={translate('feature.rendererInspector.copied')} tone="success" /> : null}
          {copyState === 'error' ? <ui.Toast message={translate('feature.rendererInspector.copyError')} tone="error" /> : null}
          {inspection.stalePreferences.length ? (
            <ui.Toast
              message={translate('feature.rendererInspector.stale', {
                count: inspection.stalePreferences.length,
              })}
              tone="warning"
            />
          ) : null}
          {inspection.renderErrors.length ? (
            <ui.Toast
              message={translate('feature.rendererInspector.renderErrors', {
                count: inspection.renderErrors.length,
              })}
              tone="error"
            />
          ) : null}

          <div className="renderer-plugin-inspector__result-count">
            {translate('feature.rendererInspector.results', {
              dormant: filtered.dormant.length,
              slots: filtered.nodes.length,
            })}
          </div>
          <div className="renderer-plugin-inspector__results" role="list">
            {filtered.nodes.map((node) => (
              <InspectionNode key={node.path} node={node} translate={translate} />
            ))}
            {filtered.dormant.map((candidate) => (
              <DormantInspectionEntry
                key={`${candidate.slotId}/${candidate.entryId}`}
                candidate={candidate}
                translate={translate}
              />
            ))}
            {filtered.nodes.length === 0 && filtered.dormant.length === 0 ? (
              <div className="renderer-plugin-inspector__empty" role="status">
                {translate('feature.rendererInspector.empty')}
              </div>
            ) : null}
          </div>
        </div>
      </details>
    </ui.Section>
  );
}

function InspectionNode({
  node,
  translate,
}: Readonly<{
  node: RendererSlotInspectionNode;
  translate: RendererTranslate;
}>) {
  const activeEntryLabel = node.activeEntryIds.length === 0
    ? translate('feature.rendererInspector.fallback')
    : node.activeEntryIds.length === 1
      ? node.activeEntryIds[0]
      : translate('feature.rendererInspector.activeCount', { count: node.activeEntryIds.length });
  const activeEntryTitle = node.activeEntryIds.join(', ') || activeEntryLabel;

  return (
    <details className="renderer-plugin-inspector__entry" role="listitem">
      <summary className="renderer-plugin-inspector__entry-summary">
        <span
          className={`renderer-plugin-inspector__state-dot renderer-plugin-inspector__state-dot--${node.activeEntryIds.length ? 'active' : 'fallback'}`}
          aria-hidden="true"
        />
        <code title={node.slotId}>{node.slotId}</code>
        <span className="renderer-plugin-inspector__kind">{node.kind}</span>
        <span className="renderer-plugin-inspector__winner" title={activeEntryTitle}>
          {activeEntryLabel}
        </span>
        <ChevronRight className="renderer-plugin-inspector__entry-chevron" size={14} aria-hidden="true" />
      </summary>
      <pre>{JSON.stringify({
        activeEntryIds: node.activeEntryIds,
        candidates: node.candidates,
        declaredBy: node.declaredBy,
        defaultActiveEntryIds: node.defaultActiveEntryIds,
        path: node.path,
        required: node.required,
        requiredKeys: node.requiredKeys,
      }, null, 2)}</pre>
    </details>
  );
}

function DormantInspectionEntry({
  candidate,
  translate,
}: Readonly<{
  candidate: RendererSlotInspectionCandidate;
  translate: RendererTranslate;
}>) {
  return (
    <details className="renderer-plugin-inspector__entry" role="listitem">
      <summary className="renderer-plugin-inspector__entry-summary">
        <span className="renderer-plugin-inspector__state-dot renderer-plugin-inspector__state-dot--dormant" aria-hidden="true" />
        <code title={candidate.slotId}>{candidate.slotId}</code>
        <span className="renderer-plugin-inspector__kind">
          {translate('feature.rendererInspector.stateDormant')}
        </span>
        <span className="renderer-plugin-inspector__winner" title={candidate.entryId}>
          {candidate.entryId}
        </span>
        <ChevronRight className="renderer-plugin-inspector__entry-chevron" size={14} aria-hidden="true" />
      </summary>
      <pre>{JSON.stringify(candidate, null, 2)}</pre>
    </details>
  );
}

export function filterRendererPluginInspection(
  inspection: Pick<RendererSlotInspection, 'dormant' | 'roots'>,
  rawQuery: string,
  stateFilter: StateFilter,
): Readonly<{
  dormant: readonly RendererSlotInspectionCandidate[];
  nodes: readonly RendererSlotInspectionNode[];
}> {
  const query = rawQuery.trim().toLowerCase();
  const dormant = stateFilter === 'all' || stateFilter === 'dormant'
    ? inspection.dormant.filter((candidate) => candidateMatchesQuery(candidate, query))
    : [];
  return Object.freeze({
    dormant: Object.freeze(dormant),
    nodes: Object.freeze(filterInspectionNodes(inspection.roots, query, stateFilter)),
  });
}

function filterInspectionNodes(
  roots: readonly RendererSlotInspectionNode[],
  rawQuery: string,
  stateFilter: StateFilter,
): RendererSlotInspectionNode[] {
  const query = rawQuery.trim().toLowerCase();
  return flattenInspectionNodes(roots).filter((node) => {
    const candidates = stateFilter === 'all'
      ? node.candidates
      : node.candidates.filter(({ state }) => state === stateFilter);
    if (stateFilter !== 'all' && candidates.length === 0) return false;
    if (!query) return true;
    return [
      node.slotId,
      node.path,
      node.declaredBy.pluginId,
      ...candidates.flatMap((candidate) => [
        candidate.entryId,
        candidate.owner.pluginId,
        candidate.state,
      ]),
    ].some((value) => value.toLowerCase().includes(query));
  });
}

function flattenInspectionNodes(
  roots: readonly RendererSlotInspectionNode[],
): RendererSlotInspectionNode[] {
  return roots.flatMap((node) => [node, ...flattenInspectionNodes(node.children)]);
}

function candidateMatchesQuery(
  candidate: RendererSlotInspectionCandidate,
  query: string,
): boolean {
  if (!query) return true;
  return [
    candidate.entryId,
    candidate.key,
    candidate.owner.pluginId,
    candidate.owner.scopeId,
    candidate.slotId,
    candidate.state,
  ].some((value) => value?.toLowerCase().includes(query));
}
