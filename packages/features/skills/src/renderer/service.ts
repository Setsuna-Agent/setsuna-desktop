import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillPatch,
} from '@setsuna-desktop/contracts';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type {
  SkillsOperationOptions,
  SkillsRendererListener,
  SkillsRendererService,
  SkillsRendererSnapshot,
} from '../contracts/index.js';
import type { SkillsRendererClient } from './client.js';

const EMPTY_SNAPSHOT: SkillsRendererSnapshot = Object.freeze({
  extraRoots: Object.freeze([]),
  skills: Object.freeze([]),
});

/** Owns Skill catalog state and serializes mutations against stale refreshes. */
export class RendererSkillsService implements SkillsRendererService {
  private snapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<SkillsRendererListener>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private stateVersion = 0;
  private refreshSequence = 0;
  private appliedRefreshSequence = 0;

  constructor(private readonly options: Readonly<{
    client: SkillsRendererClient;
    scope: FeatureScope;
  }>) {
    options.scope.add(() => this.listeners.clear());
  }

  getSnapshot(): SkillsRendererSnapshot {
    return this.snapshot;
  }

  inspectDirectories(paths: string[], options?: SkillsOperationOptions) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.inspectDirectories(paths, { signal }),
      options,
    );
  }

  subscribe(listener: SkillsRendererListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh(options?: SkillsOperationOptions): Promise<RuntimeSkillList> {
    const sequence = ++this.refreshSequence;
    const stateVersion = this.stateVersion;
    const precedingMutations = this.mutationQueue;
    const list = await this.options.scope.runOperation(async (signal) => {
      await precedingMutations;
      return this.options.client.listSkills({ signal });
    }, options);
    if (stateVersion === this.stateVersion && sequence >= this.appliedRefreshSequence) {
      this.appliedRefreshSequence = sequence;
      this.applySkills(list.skills);
    }
    return list;
  }

  createSkill(input: RuntimeSkillInput, options?: SkillsOperationOptions) {
    return this.runMutation(
      (signal) => this.options.client.createSkill(input, { signal }),
      (skill) => this.applySkills(sortedSkills([
        ...this.snapshot.skills.filter((item) => item.id !== skill.id),
        skill,
      ])),
      options,
    );
  }

  getSkill(skillId: string, options?: SkillsOperationOptions) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.getSkill(skillId, { signal }),
      options,
    );
  }

  updateSkill(skillId: string, patch: RuntimeSkillPatch, options?: SkillsOperationOptions) {
    return this.runMutation(
      (signal) => this.options.client.updateSkill(skillId, patch, { signal }),
      (skill) => this.applySkills(this.snapshot.skills.map((item) => (
        item.id === skill.id ? skill : item
      ))),
      options,
    );
  }

  async deleteSkill(skillId: string, options?: SkillsOperationOptions): Promise<void> {
    await this.runMutation(
      async (signal) => {
        await this.options.client.deleteSkill(skillId, { signal });
      },
      () => this.applySkills(this.snapshot.skills.filter((item) => item.id !== skillId)),
      options,
    );
  }

  installMcpDependencies(skillId: string, options?: SkillsOperationOptions) {
    return this.runMutationWithRefresh(
      (signal) => this.options.client.installMcpDependencies(skillId, { signal }),
      options,
    );
  }

  authenticateMcpDependency(
    skillId: string,
    serverKey: string,
    options?: SkillsOperationOptions,
  ) {
    return this.runMutationWithRefresh(
      (signal) => this.options.client.authenticateMcpDependency(skillId, serverKey, { signal }),
      options,
    );
  }

  setExtraRoots(extraRoots: string[], options?: SkillsOperationOptions): Promise<RuntimeSkillList> {
    const normalizedRoots = normalizeSkillExtraRoots(extraRoots);
    return this.runMutation(
      (signal) => this.options.client.setExtraRoots(normalizedRoots, { signal }),
      (list) => this.applySkills(list.skills, normalizedRoots),
      options,
    );
  }

  private runMutationWithRefresh<T extends RuntimeSkillDetail | Readonly<{ skill: RuntimeSkillDetail }>>(
    operation: (signal: AbortSignal) => Promise<T>,
    options?: SkillsOperationOptions,
  ): Promise<T> {
    return this.runMutation(
      async (signal) => {
        const result = await operation(signal);
        const list = await this.options.client.listSkills({ signal });
        return { list, result };
      },
      ({ list }) => this.applySkills(list.skills),
      options,
    ).then(({ result }) => result);
  }

  private runMutation<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    commit: (value: T) => void,
    options?: SkillsOperationOptions,
  ): Promise<T> {
    this.stateVersion += 1;
    const result = this.mutationQueue.then(async () => {
      const value = await this.options.scope.runOperation(operation, options);
      commit(value);
      return value;
    });
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private applySkills(
    skills: readonly RuntimeSkillList['skills'][number][],
    extraRoots: readonly string[] = this.snapshot.extraRoots,
  ): void {
    this.snapshot = Object.freeze({
      extraRoots: Object.freeze([...extraRoots]),
      skills: Object.freeze([...skills]),
    });
    for (const listener of this.listeners) listener();
  }
}

export function normalizeSkillExtraRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map((root) => root.trim()).filter(Boolean))];
}

function sortedSkills(skills: readonly RuntimeSkillList['skills'][number][]) {
  return [...skills].sort((left, right) => left.name.localeCompare(right.name));
}
