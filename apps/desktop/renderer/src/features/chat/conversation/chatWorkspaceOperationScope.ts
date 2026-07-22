export function commitChatWorkspaceOperation(
  isCurrentOperation: () => boolean,
  commit: () => void,
): boolean {
  if (!isCurrentOperation()) return false;
  commit();
  return true;
}
