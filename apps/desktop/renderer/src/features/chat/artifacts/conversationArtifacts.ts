import { workspaceFilePathKey, type RuntimeMessage } from '@setsuna-desktop/contracts';
import { artifactResultCodec, legacyArtifactResultCodec, PUBLISH_ARTIFACT_TOOL_NAME, type RuntimeArtifact } from '@setsuna-desktop/feature-artifact/contracts';
import { chatDesignResult, chatDesignTool, designFileKey, type ChatDesignResult, type DesignConversationOwner } from '@setsuna-desktop/feature-design/contracts';

export type ConversationArtifact = { kind: 'file'; file: RuntimeArtifact } | {
  kind: 'design'; design: ChatDesignResult; turnId?: string; openRequest: string;
};

export function designEntryKey(owner: DesignConversationOwner) { return JSON.stringify([designFileKey(owner.ref), owner.documentId]); }

export function conversationArtifacts(messages: readonly RuntimeMessage[]) {
  const entries = new Map<string, ConversationArtifact>();
  for (const message of messages) for (const run of message.toolRuns ?? []) {
    if (run.status !== 'success') continue;
    if (run.name === chatDesignTool) {
      const design = chatDesignResult(run.data);
      if (!design) continue;
      const key = designEntryKey(design);
      const previous = entries.get(key);
      // Later batches refresh the canvas without stealing focus after the user closes it.
      const openRequest = design.action === 'edit' && previous?.kind === 'design' && previous.turnId === message.turnId
        ? previous.openRequest : run.id;
      entries.delete(key);
      entries.set(key, { kind: 'design', design, turnId: message.turnId, openRequest });
    } else if (run.name === PUBLISH_ARTIFACT_TOOL_NAME) {
      const file = publishedFile(run.data);
      if (file) entries.set(workspaceFilePathKey(file.workspaceRoot, file.path), { kind: 'file', file });
    }
  }
  return entries;
}

function publishedFile(data: unknown) {
  if (!data || typeof data !== 'object') return;
  try {
    if ('resultKind' in data) return data.resultKind === 'artifact.file' && 'resultMajor' in data && data.resultMajor === 1 && 'payload' in data
      ? artifactResultCodec.parse(data.payload) : undefined;
    return legacyArtifactResultCodec.parse(data);
  } catch { return; }
}
