export type RuntimeThreadMessagePageInfo = {
  nextBefore: number | null;
  total: number;
};

export type RuntimeMessagePageQuery = {
  before?: number;
  /** Target record count; transcript pages keep prompts together up to a hard cap of 200 records. */
  limit?: number;
};
