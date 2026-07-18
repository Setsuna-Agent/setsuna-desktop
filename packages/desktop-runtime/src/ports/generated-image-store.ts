export type GeneratedImageStoreInput = {
  name: string;
  type: string;
  data: Uint8Array;
};

export type GeneratedImageStore = {
  clone(assetId: string): Promise<{ assetId: string }>;
  create(input: GeneratedImageStoreInput): Promise<{ assetId: string }>;
  delete(assetId: string): Promise<void>;
  recover(retainedAssetIds: string[]): Promise<void>;
};

export type GeneratedImageReader = {
  read(assetId: string): Promise<GeneratedImageStoreInput>;
};
