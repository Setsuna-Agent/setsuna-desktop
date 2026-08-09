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
  'openai-vision-recognition': {
    name: 'capabilities.plugin.openai-vision-recognition.name',
    description: 'capabilities.plugin.openai-vision-recognition.description',
  },
  'web-search': {
    name: 'capabilities.plugin.web-search.name',
    description: 'capabilities.plugin.web-search.description',
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
  'pi-question': {
    name: 'capabilities.plugin.pi-question.name',
    description: 'capabilities.plugin.pi-question.description',
  },
  'pi-todo': {
    name: 'capabilities.plugin.pi-todo.name',
    description: 'capabilities.plugin.pi-todo.description',
  },
  'pi-claude-rules': {
    name: 'capabilities.plugin.pi-claude-rules.name',
    description: 'capabilities.plugin.pi-claude-rules.description',
  },
} satisfies Record<string, PluginCopyKeys>;

export function localizedPluginCopy(plugin: PluginCopySource, t: Translate): Pick<PluginCopySource, 'name' | 'description'> {
  const keys = builtInPluginCopyKeys[plugin.id as keyof typeof builtInPluginCopyKeys];
  if (!keys) return { name: plugin.name, description: plugin.description };
  return { name: t(keys.name), description: t(keys.description) };
}
