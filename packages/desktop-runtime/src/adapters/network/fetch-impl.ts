/** Narrow fetch shape shared by runtime network adapters that never accept Request objects. */
export type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;
