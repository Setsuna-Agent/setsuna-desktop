export type PersistentToolApprovalStore = {
  hasAll(keys: string[]): Promise<boolean>;
  approve(keys: string[]): Promise<void>;
};
