import { isRuntimeThreadReference, threadMentionText, type RuntimeThreadReference } from '@setsuna-desktop/contracts';

const THREAD_REFERENCE_TYPE = 'application/x-setsuna-thread+json';

export function writeThreadReferenceDrag(dataTransfer: DataTransfer, thread: RuntimeThreadReference): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(THREAD_REFERENCE_TYPE, JSON.stringify({ id: thread.id, title: thread.title }));
  dataTransfer.setData('text/plain', threadMentionText(thread));
}

export function hasThreadReferenceDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(THREAD_REFERENCE_TYPE);
}

export function readThreadReferenceDrag(dataTransfer: DataTransfer): RuntimeThreadReference | null {
  try {
    const thread: unknown = JSON.parse(dataTransfer.getData(THREAD_REFERENCE_TYPE));
    return isRuntimeThreadReference(thread) ? { id: thread.id, title: thread.title } : null;
  } catch { return null; }
}
