export type GeneratedImageStoreInput = {
  name: string;
  type: string;
  data: Uint8Array;
};

export type GeneratedImageStore = {
  create(input: GeneratedImageStoreInput): Promise<{ assetId: string }>;
};
