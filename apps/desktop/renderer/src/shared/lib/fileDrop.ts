export function hasFileDrop(data: DataTransfer): boolean {
  // FileList is protected until drop, so dragover must inspect types/items instead.
  return Array.from(data.types).includes('Files') || Array.from(data.items).some((item) => item.kind === 'file');
}

export function readDroppedFiles(data: DataTransfer): File[] {
  const items = Array.from(data.items).filter((item) => item.kind === 'file');
  if (!items.length) return Array.from(data.files);
  return items.flatMap((item) => {
    if (item.webkitGetAsEntry?.()?.isDirectory) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
