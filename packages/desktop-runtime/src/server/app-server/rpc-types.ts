export type AppServerRpcRequest = {
  id?: string | number | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export type AppServerRpcResponse =
  | { id: string | number | null; result: unknown }
  | { id: string | number | null; error: { code: number; message: string; data?: unknown } };
