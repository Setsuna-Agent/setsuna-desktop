type ClipboardImage = {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toBitmap(): Buffer;
};

/** Native clipboard writes can silently fail while another Windows process holds the clipboard. */
export async function writeImageToClipboard<TImage extends ClipboardImage>(
  image: TImage,
  clipboard: { writeImage(image: TImage): void; readImage(): TImage },
): Promise<void> {
  const size = image.getSize();
  let expectedBitmap: Buffer | undefined;
  for (const waitMs of [0, 50, 100]) {
    if (waitMs) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    try {
      clipboard.writeImage(image);
      const copied = clipboard.readImage();
      if (copied.isEmpty()) continue;
      const copiedSize = copied.getSize();
      if (copiedSize.width !== size.width || copiedSize.height !== size.height) continue;
      expectedBitmap ??= image.toBitmap();
      // A previous image of the same size must not count as a successful write.
      if (expectedBitmap.length && copied.toBitmap().equals(expectedBitmap)) return;
    } catch {
      // A transient native read/write failure gets the same bounded retry.
    }
  }
  throw new Error('Failed to copy image.');
}
