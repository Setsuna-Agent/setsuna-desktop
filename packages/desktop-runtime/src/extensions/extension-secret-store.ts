import { randomUUID } from 'node:crypto';
import type { RuntimePluginUiFieldNode } from '@setsuna-desktop/contracts';
import type { ExtensionStateStore } from '../ports/extension-runtime.js';
import type { SecretStore } from '../ports/secret-store.js';

// Workers can select only global/project/thread scope. This record contains an
// opaque vault reference, never credentials, and cannot be projected by a page.
const REFERENCE_SCOPE = 'host:secrets';
const REFERENCE_KEY = 'vaultRef';

export class ExtensionSecretStore {
  private readonly updates = new Map<string, Promise<void>>();

  constructor(
    private readonly state: Pick<ExtensionStateStore, 'get' | 'set' | 'delete'>,
    private readonly vault: Pick<SecretStore, 'get' | 'set' | 'delete'>,
  ) {}

  async get(pluginId: string, name: string): Promise<string | undefined> {
    const values = await this.read(pluginId);
    return Object.hasOwn(values, name) ? values[name] : undefined;
  }

  async configured(pluginId: string, fields: readonly RuntimePluginUiFieldNode[]): Promise<readonly string[]> {
    const values = await this.read(pluginId);
    return fields.filter(({ name }) => Object.hasOwn(values, name) && values[name]).map(({ name }) => name);
  }

  async apply(
    pluginId: string,
    fields: readonly RuntimePluginUiFieldNode[],
    changes: Readonly<Record<string, string | null>>,
    signal?: AbortSignal,
  ): Promise<void> {
    const declared = new Map(fields.map((field) => [field.name, field]));
    for (const [name, value] of Object.entries(changes)) {
      const field = declared.get(name);
      if (!field || (value !== null && (typeof value !== 'string' || value.length > (field.maxLength ?? 4_000)))) {
        throw new Error('Invalid Plugin secret change.');
      }
    }
    await this.serialize(pluginId, async () => {
      const reference = await this.reference(pluginId);
      const values = await this.read(pluginId, reference);
      let changed = false;
      for (const [name, value] of Object.entries(changes)) {
        if (value === null) {
          delete values[name];
          changed = true;
        } else if (value.trim()) {
          values[name] = value;
          changed = true;
        }
      }
      if (fields.some((field) => field.required && (!Object.hasOwn(values, field.name) || !values[field.name]?.trim()))) {
        throw new Error('A required Plugin secret is missing.');
      }
      signal?.throwIfAborted();
      if (!changed) return;
      const nextReference = reference ?? `plugin.credentials.${randomUUID()}`;
      await this.vault.set(nextReference, JSON.stringify(values));
      if (!reference) {
        try {
          await this.state.set(pluginId, REFERENCE_SCOPE, REFERENCE_KEY, nextReference);
        } catch (error) {
          await this.vault.delete(nextReference);
          throw error;
        }
      }
    });
  }

  async deletePlugin(
    pluginId: string,
    removeState: () => Promise<void> = () => this.state.delete(pluginId, REFERENCE_SCOPE, REFERENCE_KEY),
  ): Promise<void> {
    await this.serialize(pluginId, async () => {
      const reference = await this.reference(pluginId);
      if (!reference) return removeState();
      const stored = await this.vault.get(reference);
      try {
        await this.vault.delete(reference);
        // The caller atomically removes Plugin state, including the reference.
        await removeState();
      } catch (error) {
        // Keep rollback material in memory only: a failed uninstall must retain
        // credentials when its index, files and ordinary state are restored.
        if (stored !== undefined) {
          try {
            await this.vault.set(reference, stored);
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Plugin credential removal failed and rollback was incomplete.');
          }
        }
        throw error;
      }
    });
  }

  private async reference(pluginId: string): Promise<string | undefined> {
    const reference = await this.state.get(pluginId, REFERENCE_SCOPE, REFERENCE_KEY);
    if (reference === undefined) return undefined;
    if (typeof reference !== 'string' || !/^plugin\.credentials\.[a-f0-9-]{36}$/u.test(reference)) {
      throw new Error('Invalid Plugin credential reference.');
    }
    return reference;
  }

  private async read(pluginId: string, reference?: string): Promise<Record<string, string>> {
    const ref = reference ?? await this.reference(pluginId);
    if (!ref) return {};
    const stored = await this.vault.get(ref);
    if (stored === undefined) return {};
    let values: unknown;
    try {
      values = JSON.parse(stored);
    } catch {
      // JSON parser diagnostics can include the malformed plaintext document.
      throw new Error('Invalid Plugin credentials.');
    }
    if (!values || typeof values !== 'object' || Array.isArray(values)
      || Object.values(values).some((value) => typeof value !== 'string')) {
      throw new Error('Invalid Plugin credentials.');
    }
    return values as Record<string, string>;
  }

  private async serialize(pluginId: string, operation: () => Promise<void>): Promise<void> {
    const pending = (this.updates.get(pluginId) ?? Promise.resolve()).then(operation, operation);
    this.updates.set(pluginId, pending);
    try {
      await pending;
    } finally {
      if (this.updates.get(pluginId) === pending) this.updates.delete(pluginId);
    }
  }
}
