import type { Translate } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';

type PluginCopySource = {
  id: string;
  name: string;
  description?: string;
};

type PluginCopyKeys = {
  name: MessageKey;
  description: MessageKey;
};

const builtInPluginCopyKeys = {
  'audit-file-mutations': {
    name: 'capabilities.plugin.audit-file-mutations.name',
    description: 'capabilities.plugin.audit-file-mutations.description',
  },
  'compact-warning': {
    name: 'capabilities.plugin.compact-warning.name',
    description: 'capabilities.plugin.compact-warning.description',
  },
  'context7-docs': {
    name: 'capabilities.plugin.context7-docs.name',
    description: 'capabilities.plugin.context7-docs.description',
  },
  documents: {
    name: 'capabilities.plugin.documents.name',
    description: 'capabilities.plugin.documents.description',
  },
  'guard-dangerous-shell': {
    name: 'capabilities.plugin.guard-dangerous-shell.name',
    description: 'capabilities.plugin.guard-dangerous-shell.description',
  },
  'openai-docs': {
    name: 'capabilities.plugin.openai-docs.name',
    description: 'capabilities.plugin.openai-docs.description',
  },
  'openai-image-generation': {
    name: 'capabilities.plugin.openai-image-generation.name',
    description: 'capabilities.plugin.openai-image-generation.description',
  },
  pdf: {
    name: 'capabilities.plugin.pdf.name',
    description: 'capabilities.plugin.pdf.description',
  },
  'prompt-secret-detector': {
    name: 'capabilities.plugin.prompt-secret-detector.name',
    description: 'capabilities.plugin.prompt-secret-detector.description',
  },
  'protect-generated-folders': {
    name: 'capabilities.plugin.protect-generated-folders.name',
    description: 'capabilities.plugin.protect-generated-folders.description',
  },
  'protect-secret-paths': {
    name: 'capabilities.plugin.protect-secret-paths.name',
    description: 'capabilities.plugin.protect-secret-paths.description',
  },
  'session-start-project-guidance': {
    name: 'capabilities.plugin.session-start-project-guidance.name',
    description: 'capabilities.plugin.session-start-project-guidance.description',
  },
  'stop-todo-continuation': {
    name: 'capabilities.plugin.stop-todo-continuation.name',
    description: 'capabilities.plugin.stop-todo-continuation.description',
  },
} satisfies Record<string, PluginCopyKeys>;

export function localizedPluginCopy(plugin: PluginCopySource, t: Translate): Pick<PluginCopySource, 'name' | 'description'> {
  const keys = builtInPluginCopyKeys[plugin.id as keyof typeof builtInPluginCopyKeys];
  if (!keys) return { name: plugin.name, description: plugin.description };
  return { name: t(keys.name), description: t(keys.description) };
}

export function localizedPluginSearchAliases(plugin: PluginCopySource, t: Translate): string[] {
  const copy = localizedPluginCopy(plugin, t);
  return [copy.name, copy.description ?? ''];
}
