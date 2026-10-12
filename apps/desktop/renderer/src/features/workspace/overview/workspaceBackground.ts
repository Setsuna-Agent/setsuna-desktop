const databaseName = 'setsuna.workspace-overview.v1';
const storeName = 'appearance';
const backgroundKey = 'background';
export const WORKSPACE_BACKGROUND_CHANNEL = 'setsuna:workspace-background-changed';
export const WORKSPACE_BACKGROUND_ACCEPT = 'image/png,image/jpeg,image/webp';

export function isWorkspaceBackgroundFile(file: Pick<File, 'type' | 'size'>): boolean {
  return WORKSPACE_BACKGROUND_ACCEPT.split(',').includes(file.type) && file.size > 0 && file.size <= 20 * 1024 * 1024;
}

export async function prepareWorkspaceBackground(file: File): Promise<Blob> {
  if (!isWorkspaceBackgroundFile(file)) throw new Error('Invalid background image.');
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion unavailable.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob && blob.size <= 4 * 1024 * 1024) resolve(blob);
        else reject(new Error('Unable to encode background image.'));
      }, 'image/webp', 0.85);
    });
  } finally { image.close(); }
}

export const readWorkspaceBackground = (): Promise<Blob | null> => backgroundRequest();
export async function writeWorkspaceBackground(image: Blob | null): Promise<void> {
  await backgroundRequest(image);
  // Notify even if the initiating panel unmounted while its selected image was being saved.
  const updates = new BroadcastChannel(WORKSPACE_BACKGROUND_CHANNEL);
  updates.postMessage(null);
  updates.close();
}

/** Keep image bytes out of synchronous localStorage and load only when the overview mounts. */
function backgroundRequest(image?: Blob | null): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 1);
    opening.onupgradeneeded = () => { opening.result.createObjectStore(storeName); };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      try {
        const transaction = database.transaction(storeName, image === undefined ? 'readonly' : 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = image === undefined ? store.get(backgroundKey)
          : image === null ? store.delete(backgroundKey) : store.put(image, backgroundKey);
        transaction.oncomplete = () => {
          database.close();
          const result: unknown = image === undefined ? request.result : image;
          resolve(result instanceof Blob ? result : null);
        };
        transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
      } catch (error) { database.close(); reject(error); }
    };
  });
}
