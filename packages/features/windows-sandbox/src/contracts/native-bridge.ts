export const DESKTOP_SANDBOX_NETWORK_ENVIRONMENT_PATH = '/v1/network-proxy/sandbox-environment';

export const DESKTOP_WINDOWS_SANDBOX_PROXY_PORTS = Object.freeze([
  61080,
  61081,
  61082,
  61083,
  61084,
  61085,
  61086,
  61087,
  61088,
  61089,
]);

/** Runtime-only proxy variables whose credentials are valid for this app launch. */
export type DesktopSandboxNetworkEnvironment = Record<string, string>;
