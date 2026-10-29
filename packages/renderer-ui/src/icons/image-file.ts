export type ImageFileReadOptions = Readonly<{
  mimeTypes: readonly string[];
  maxBytes: number;
  copy: Readonly<{ emptyFile: string; invalidType: string; readError: string; tooLarge: string }>;
}>;

export function imageFileError(file: Pick<File, 'size' | 'type'>, { mimeTypes, maxBytes, copy }: ImageFileReadOptions): string | null {
  if (!mimeTypes.includes(file.type.toLowerCase())) return copy.invalidType;
  if (file.size <= 0) return copy.emptyFile;
  if (file.size > maxBytes) return copy.tooLarge;
  return null;
}

/** Read only bounded, supported images. Each caller validates the returned data URL at its contract boundary. */
export function readImageFile(file: File, options: ImageFileReadOptions): Promise<string> {
  const error = imageFileError(file, options);
  if (error) return Promise.reject(new Error(error));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(options.copy.readError));
    reader.onabort = () => reject(new Error(options.copy.readError));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result) : reject(new Error(options.copy.readError));
    reader.readAsDataURL(file);
  });
}
