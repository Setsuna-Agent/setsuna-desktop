export type SecretStoreStatus = {
  available: boolean;
  backend: string;
};

export interface SecretStore {
  status(): Promise<SecretStoreStatus>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DesktopNativeBridge extends SecretStore {
  openExternal(url: string): Promise<void>;
}
