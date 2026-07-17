import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProjectPackageManager,
  ProjectPackageManagerName,
  ProjectWorkflow,
  ProjectWorkflowManifest,
  ProjectWorkflowResolver,
  ProjectWorkflowScript,
} from '../../ports/project-workflow-resolver.js';

const PACKAGE_MANAGER_NAMES = ['pnpm', 'yarn', 'npm', 'bun'] as const satisfies readonly ProjectPackageManagerName[];
const SCRIPT_FAMILIES = ['test', 'lint', 'typecheck', 'build', 'check', 'verify', 'format'] as const;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SCRIPT_DEFINITION_BYTES = 512;
const MAX_SCRIPTS = 20;
const MAX_WARNINGS = 12;
const MAX_MANAGER_EVIDENCE = 12;
const MAX_ANCESTRY_DIRECTORIES = 32;
const MAX_CACHE_ENTRIES = 64;

const LOCKFILE_MANAGERS: Readonly<Record<string, ProjectPackageManagerName>> = {
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'npm-shrinkwrap.json': 'npm',
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
};

const WORKSPACE_CONFIG_MANAGERS: Readonly<Record<string, ProjectPackageManagerName>> = {
  '.yarnrc.yml': 'yarn',
  'bunfig.toml': 'bun',
  'pnpm-workspace.yaml': 'pnpm',
};

const NODE_WORKFLOW_FILENAMES = [
  'package.json',
  ...Object.keys(LOCKFILE_MANAGERS),
  ...Object.keys(WORKSPACE_CONFIG_MANAGERS),
];

type CandidateFile = {
  candidatePath: string;
  depth: number;
  directory: string;
  filename: string;
};

type CandidateState = CandidateFile & ({
  exists: false;
} | {
  exists: true;
  ctimeMs: number;
  mtimeMs: number;
  resolvedPath: string;
  size: number;
});

type LoadedManifest = {
  depth: number;
  descriptor: ProjectWorkflowManifest;
  value: Record<string, unknown> | null;
};

type ManagerEvidence = {
  depth: number;
  kind: 'manifest' | 'lockfile' | 'workspace' | 'engine';
  name: ProjectPackageManagerName;
  source: string;
  version?: string;
};

type CacheEntry = {
  fingerprint: string;
  workflow: ProjectWorkflow | null;
};

type CandidateScan = {
  files: CandidateFile[];
  omittedDirectoryCount: number;
};

/**
 * 从工作区祖先目录解析受限的 Node.js 工作流事实。其他生态可在同一端口后接入，
 * 无需扩大提示组装逻辑。
 */
export class FileProjectWorkflowResolver implements ProjectWorkflowResolver {
  private readonly cache = new Map<string, CacheEntry>();

  async resolve({ environment }: Parameters<ProjectWorkflowResolver['resolve']>[0]): Promise<ProjectWorkflow | null> {
    const root = await canonicalPath(environment.workspaceRoot);
    const requestedCwd = await canonicalPath(environment.cwd);
    const cwd = pathIsWithin(root, requestedCwd) ? requestedCwd : root;
    const candidates = candidateFiles(root, cwd);
    const states = await Promise.all(candidates.files.map((candidate) => inspectCandidate(root, candidate)));
    const fingerprint = candidateFingerprint(states);
    const cacheKey = `${root}\0${cwd}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.fingerprint === fingerprint) return cached.workflow;

    const workflow = await inspectNodeWorkflow(root, cwd, states, candidates.omittedDirectoryCount);
    this.remember(cacheKey, { fingerprint, workflow });
    return workflow;
  }

  private remember(key: string, entry: CacheEntry): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    if (this.cache.size <= MAX_CACHE_ENTRIES) return;
    const oldestKey = this.cache.keys().next().value as string | undefined;
    if (oldestKey) this.cache.delete(oldestKey);
  }
}

async function inspectNodeWorkflow(
  root: string,
  cwd: string,
  states: CandidateState[],
  omittedDirectoryCount: number,
): Promise<ProjectWorkflow | null> {
  const existingStates = states.filter((state): state is Extract<CandidateState, { exists: true }> => state.exists);
  if (!existingStates.length) return null;

  const warnings: string[] = [];
  if (omittedDirectoryCount) {
    warnings.push(`Skipped ${omittedDirectoryCount} middle ancestor directories while bounding project workflow discovery.`);
  }
  const manifests = await loadManifests(root, existingStates, warnings);
  const evidence = managerEvidence(root, manifests, existingStates, warnings);
  const packageManager = selectPackageManager(evidence, warnings);
  const scripts = workflowScripts(manifests, evidence, warnings);

  return {
    root,
    cwd,
    manifests: manifests.map((manifest) => manifest.descriptor),
    ...(packageManager ? { packageManager } : {}),
    scripts,
    warnings: boundedWarnings(warnings),
  };
}

async function loadManifests(
  root: string,
  states: Array<Extract<CandidateState, { exists: true }>>,
  warnings: string[],
): Promise<LoadedManifest[]> {
  const manifests: LoadedManifest[] = [];
  for (const state of states.filter((candidate) => candidate.filename === 'package.json')) {
    const relativePath = workspaceRelativePath(root, state.candidatePath);
    const descriptor: ProjectWorkflowManifest = {
      kind: 'node-package',
      path: state.candidatePath,
      directory: state.directory,
    };
    if (state.size > MAX_MANIFEST_BYTES) {
      warnings.push(`${relativePath} exceeds the ${MAX_MANIFEST_BYTES}-byte workflow inspection limit.`);
      manifests.push({ depth: state.depth, descriptor, value: null });
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(state.resolvedPath, 'utf8'));
      if (!isRecord(parsed)) throw new Error('the root value is not an object');
      manifests.push({ depth: state.depth, descriptor, value: parsed });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`Could not parse ${relativePath}: ${detail}`);
      manifests.push({ depth: state.depth, descriptor, value: null });
    }
  }
  return manifests;
}

function managerEvidence(
  root: string,
  manifests: LoadedManifest[],
  states: Array<Extract<CandidateState, { exists: true }>>,
  warnings: string[],
): ManagerEvidence[] {
  const evidence: ManagerEvidence[] = [];

  for (const manifest of manifests) {
    if (!manifest.value) continue;
    const sourcePath = workspaceRelativePath(root, manifest.descriptor.path);
    if (Object.hasOwn(manifest.value, 'packageManager')) {
      const declared = parsePackageManager(manifest.value.packageManager);
      if (declared) {
        evidence.push({
          depth: manifest.depth,
          kind: 'manifest',
          name: declared.name,
          source: `${sourcePath}#packageManager`,
          ...(declared.version ? { version: declared.version } : {}),
        });
      } else {
        warnings.push(`Ignored unsupported packageManager in ${sourcePath}.`);
      }
    }

    const engines = isRecord(manifest.value.engines) ? manifest.value.engines : null;
    for (const name of PACKAGE_MANAGER_NAMES) {
      if (typeof engines?.[name] === 'string' && engines[name].trim()) {
        evidence.push({
          depth: manifest.depth,
          kind: 'engine',
          name,
          source: `${sourcePath}#engines.${name}`,
        });
      }
    }
  }

  for (const state of states) {
    const lockfileManager = LOCKFILE_MANAGERS[state.filename];
    if (lockfileManager) {
      evidence.push({
        depth: state.depth,
        kind: 'lockfile',
        name: lockfileManager,
        source: workspaceRelativePath(root, state.candidatePath),
      });
    }
    const workspaceManager = WORKSPACE_CONFIG_MANAGERS[state.filename];
    if (workspaceManager) {
      evidence.push({
        depth: state.depth,
        kind: 'workspace',
        name: workspaceManager,
        source: workspaceRelativePath(root, state.candidatePath),
      });
    }
  }

  return evidence;
}

function selectPackageManager(evidence: ManagerEvidence[], warnings: string[]): ProjectPackageManager | undefined {
  const priorities: ManagerEvidence['kind'][] = ['manifest', 'lockfile', 'workspace', 'engine'];
  for (const kind of priorities) {
    const atPriority = evidence.filter((entry) => entry.kind === kind);
    if (!atPriority.length) continue;
    const nearestDepth = Math.max(...atPriority.map((entry) => entry.depth));
    const inScope = atPriority.filter((entry) => entry.depth === nearestDepth);
    const names = unique(inScope.map((entry) => entry.name));
    if (names.length !== 1) {
      warnings.push(`Conflicting ${kind} package-manager evidence at the effective workspace scope: ${inScope.map(formatEvidence).join(', ')}.`);
      return undefined;
    }

    const name = names[0];
    const selectedEvidence = evidence
      .filter((entry) => entry.name === name)
      .sort(compareEvidence);
    const conflicts = evidence.filter((entry) => entry.name !== name);
    if (conflicts.length) {
      warnings.push(`Selected ${name} from ${inScope.map((entry) => entry.source).join(', ')}, but conflicting evidence also exists: ${conflicts.map(formatEvidence).join(', ')}.`);
    }
    const version = inScope.find((entry) => entry.name === name && entry.version)?.version;
    const sources = unique(selectedEvidence.map((entry) => entry.source));
    if (sources.length > MAX_MANAGER_EVIDENCE) {
      warnings.push(`Package-manager evidence was limited to ${MAX_MANAGER_EVIDENCE} entries.`);
    }
    return {
      name,
      ...(version ? { version } : {}),
      evidence: sources.slice(0, MAX_MANAGER_EVIDENCE),
    };
  }
  return undefined;
}

function workflowScripts(
  manifests: LoadedManifest[],
  evidence: ManagerEvidence[],
  warnings: string[],
): ProjectWorkflowScript[] {
  const scriptsByName = new Map<string, ProjectWorkflowScript>();
  let truncatedScriptCount = 0;
  for (const manifest of manifests) {
    if (!manifest.value) continue;
    // 嵌套包可能有意选择不同的包管理器。每次调用都依据对应清单自身作用域内
    // 可见的信息生成。
    const manager = selectPackageManager(
      evidence.filter((entry) => entry.depth <= manifest.depth),
      [],
    )?.name;
    const scripts = isRecord(manifest.value.scripts) ? manifest.value.scripts : null;
    if (!scripts) continue;
    for (const [name, value] of Object.entries(scripts)) {
      if (!isRelevantScriptName(name) || typeof value !== 'string' || !value.trim()) continue;
      const definition = truncateUtf8(value.trim(), MAX_SCRIPT_DEFINITION_BYTES);
      const truncated = Buffer.byteLength(definition, 'utf8') < Buffer.byteLength(value.trim(), 'utf8');
      if (truncated) truncatedScriptCount += 1;
      scriptsByName.set(name, {
        name,
        definition,
        ...(manager ? { invocation: scriptInvocation(manager, name) } : {}),
        cwd: manifest.descriptor.directory,
        sourcePath: manifest.descriptor.path,
        truncated,
      });
    }
  }

  const scripts = [...scriptsByName.values()].sort(compareScripts);
  if (truncatedScriptCount) {
    warnings.push(`Truncated ${truncatedScriptCount} script definitions to ${MAX_SCRIPT_DEFINITION_BYTES} bytes in project workflow context.`);
  }
  if (scripts.length > MAX_SCRIPTS) {
    warnings.push(`Project workflow exposes ${scripts.length} relevant scripts; only the first ${MAX_SCRIPTS} are included.`);
  }
  return scripts.slice(0, MAX_SCRIPTS);
}

function scriptInvocation(manager: ProjectPackageManagerName, name: string): string {
  if (manager === 'bun') return `bun run ${name}`;
  if (manager === 'npm') return name === 'test' ? 'npm test' : `npm run ${name}`;
  if (manager === 'pnpm') return name.includes(':') ? `pnpm run ${name}` : `pnpm ${name}`;
  return `yarn ${name}`;
}

function parsePackageManager(value: unknown): { name: ProjectPackageManagerName; version?: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^(bun|npm|pnpm|yarn)(?:@(.+))?$/.exec(value.trim());
  if (!match) return null;
  return {
    name: match[1] as ProjectPackageManagerName,
    ...(match[2] ? { version: match[2] } : {}),
  };
}

function isRelevantScriptName(name: string): boolean {
  return /^(test|lint|typecheck|build|check|verify|format)(?::[A-Za-z0-9._-]+)*$/.test(name);
}

function compareScripts(left: ProjectWorkflowScript, right: ProjectWorkflowScript): number {
  const leftFamily = left.name.split(':', 1)[0];
  const rightFamily = right.name.split(':', 1)[0];
  const familyOrder = SCRIPT_FAMILIES.indexOf(leftFamily as (typeof SCRIPT_FAMILIES)[number])
    - SCRIPT_FAMILIES.indexOf(rightFamily as (typeof SCRIPT_FAMILIES)[number]);
  if (familyOrder) return familyOrder;
  const leftVariant = left.name.includes(':') ? 1 : 0;
  const rightVariant = right.name.includes(':') ? 1 : 0;
  return leftVariant - rightVariant || left.name.localeCompare(right.name);
}

function compareEvidence(left: ManagerEvidence, right: ManagerEvidence): number {
  const priority: Record<ManagerEvidence['kind'], number> = { manifest: 0, lockfile: 1, workspace: 2, engine: 3 };
  return priority[left.kind] - priority[right.kind] || right.depth - left.depth || left.source.localeCompare(right.source);
}

function formatEvidence(evidence: ManagerEvidence): string {
  return `${evidence.name} via ${evidence.source}`;
}

function candidateFiles(root: string, cwd: string): CandidateScan {
  const allDirectories = directoriesFromRoot(root, cwd);
  const omittedDirectoryCount = Math.max(0, allDirectories.length - MAX_ANCESTRY_DIRECTORIES);
  const directories = omittedDirectoryCount
    ? [allDirectories[0], ...allDirectories.slice(-(MAX_ANCESTRY_DIRECTORIES - 1))]
    : allDirectories;
  return {
    files: directories.flatMap((directory, depth) => NODE_WORKFLOW_FILENAMES.map((filename) => ({
      candidatePath: path.join(directory, filename),
      depth,
      directory,
      filename,
    }))),
    omittedDirectoryCount,
  };
}

async function inspectCandidate(root: string, candidate: CandidateFile): Promise<CandidateState> {
  const resolvedPath = await realpath(candidate.candidatePath).catch(() => null);
  if (!resolvedPath || !pathIsWithin(root, resolvedPath)) return { ...candidate, exists: false };
  const stats = await stat(resolvedPath).catch(() => null);
  if (!stats?.isFile()) return { ...candidate, exists: false };
  return {
    ...candidate,
    exists: true,
    ctimeMs: stats.ctimeMs,
    mtimeMs: stats.mtimeMs,
    resolvedPath,
    size: stats.size,
  };
}

function candidateFingerprint(states: CandidateState[]): string {
  return states.map((state) => (
    state.exists
      ? `${state.candidatePath}:${state.resolvedPath}:${state.size}:${state.mtimeMs}:${state.ctimeMs}`
      : `${state.candidatePath}:-`
  )).join('|');
}

function directoriesFromRoot(root: string, cwd: string): string[] {
  const relative = path.relative(root, cwd);
  const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
  return [root, ...parts.map((_part, index) => path.join(root, ...parts.slice(0, index + 1)))];
}

async function canonicalPath(value: string): Promise<string> {
  return realpath(value).catch(() => path.resolve(value));
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function workspaceRelativePath(root: string, candidate: string): string {
  const relative = path.relative(root, candidate);
  return relative || path.basename(candidate);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let start = 0;
  let end = value.length;
  while (start < end) {
    const middle = Math.ceil((start + end) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) start = middle;
    else end = middle - 1;
  }
  return value.slice(0, start).trimEnd();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function boundedWarnings(values: string[]): string[] {
  const warnings = unique(values);
  if (warnings.length <= MAX_WARNINGS) return warnings;
  const included = warnings.slice(0, MAX_WARNINGS - 1);
  included.push(`${warnings.length - included.length} additional project workflow warnings were omitted.`);
  return included;
}
