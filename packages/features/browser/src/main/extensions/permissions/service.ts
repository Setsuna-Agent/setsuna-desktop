import type { Extension } from 'electron';
import type { ExtensionPermissions, ExtensionSystemEvent } from '../../../contracts/extension-api.js';
import type { BrowserExtensionState } from '../state.js';
import { containsPermissions, coversOrigin, manifestPermissions, mergePermissions, parseExtensionPermissions } from './model.js';
import { OPTIONAL_EXTENSION_PERMISSIONS } from '../capabilities.js';

export class BrowserExtensionPermissions {
  constructor(private readonly options: {
    state: BrowserExtensionState;
    serialize(operation: () => Promise<boolean>): Promise<boolean>;
    current(id: string): Extension | null;
    confirm(extension: Extension, permissions: ExtensionPermissions): Promise<boolean>;
    publish(id: string, event: ExtensionSystemEvent): void;
  }) {}

  getAll(extension: Extension): ExtensionPermissions {
    return mergePermissions(manifestPermissions(extension), this.optional(extension));
  }

  effective(extension: Extension): Extension {
    // Content-script match ranges appear in getAll(), but cannot authorize cookie
    // reads or other host APIs. Keep explicit host grants distinct when enforcing access.
    const granted = mergePermissions(manifestPermissions(extension, { includeContentScripts: false }), this.optional(extension));
    return { ...extension, manifest: { ...extension.manifest, permissions: granted.permissions,
      host_permissions: granted.origins } };
  }

  async call(extension: Extension, method: string, args: unknown[]): Promise<unknown> {
    if (method === 'getAll') return this.getAll(extension);
    const requested = parseExtensionPermissions(args[0]);
    if (method === 'contains') return containsPermissions(this.getAll(extension), requested);
    if (method !== 'request' && method !== 'remove') throw new Error(`Unsupported permissions method: ${method}.`);
    return this.options.serialize(async () => {
      const current = () => {
        const active = this.options.current(extension.id);
        if (!active || active.path !== extension.path || active.version !== extension.version) throw new Error('Extension context unavailable.');
        return active;
      };
      const native = current();
      // A script's injection scope is reported by getAll/contains but is not an API host grant.
      const required = manifestPermissions(native, { includeContentScripts: false });
      const optional = this.optional(native);
      if (method === 'remove') {
        // A broader optional range may include required hosts; removing its saved
        // grant leaves the narrower manifest grant intact.
        if (requested.permissions.some(value => required.permissions.includes(value))
          || requested.origins.some(value => required.origins.some(pattern => coversOrigin(pattern, value)))) return false;
        const removed = { permissions: optional.permissions.filter(value => requested.permissions.includes(value)),
          origins: optional.origins.filter(value => requested.origins.some(pattern => coversOrigin(pattern, value))) };
        if (!removed.permissions.length && !removed.origins.length) return true;
        await this.options.state.setGrantedPermissions(extension.id, {
          permissions: optional.permissions.filter(value => !removed.permissions.includes(value)),
          origins: optional.origins.filter(value => !removed.origins.includes(value)),
        });
        this.options.publish(extension.id, { kind: 'permissionsRemoved', permissions: removed });
        return true;
      }
      const granted = mergePermissions(required, optional);
      if (containsPermissions(granted, requested)) return true;
      const declared = mergePermissions(required, manifestPermissions(native, { optional: true }));
      if (!containsPermissions(declared, requested)) throw new Error('Requested permission is not declared in the manifest.');
      const added = { permissions: requested.permissions.filter(value => !granted.permissions.includes(value)),
        origins: requested.origins.filter(value => !granted.origins.some(pattern => coversOrigin(pattern, value))) };
      if (added.permissions.some(value => !OPTIONAL_EXTENSION_PERMISSIONS.has(value))) throw new Error('Requested optional API is not supported.');
      if (!await this.options.confirm(native, added)) return false;
      current();
      await this.options.state.setGrantedPermissions(extension.id, mergePermissions(optional, added));
      this.options.publish(extension.id, { kind: 'permissionsAdded', permissions: added });
      return true;
    });
  }

  private optional(extension: Extension): ExtensionPermissions {
    const saved = this.options.state.grantedPermissions(extension.id);
    const declared = manifestPermissions(extension, { optional: true });
    // An updated manifest cannot inherit grants that it no longer declares.
    return { permissions: saved.permissions.filter(value => declared.permissions.includes(value)),
      origins: saved.origins.filter(value => declared.origins.some(pattern => coversOrigin(pattern, value))) };
  }
}
