/**
 * MCP feature 未激活时的统一错误。bound control 与 tool host adapter 在
 * feature 激活前调用实际 MCP 操作时抛出，避免静默失败或回退到空实现。
 */
export function capabilityNotAvailableError(): Error {
  return new Error('The MCP feature is not active; MCP capabilities are unavailable.');
}
