import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';

const BLOCKED_ADDRESSES = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

const LOCAL_HOSTNAME_SUFFIXES = [
  '.home',
  '.internal',
  '.lan',
  '.local',
  '.localdomain',
  '.localhost',
] as const;

/** Reject host-local and private destinations before credentials or routing are resolved. */
export function assertSandboxEgressHostname(hostname: string): void {
  const normalized = normalizeHostname(hostname);
  const family = isIP(normalized);
  if (family) {
    if (!isPublicAddress(normalized, family)) throw destinationDenied(hostname);
    return;
  }
  const canonicalLiteral = canonicalIpLiteral(normalized);
  if (canonicalLiteral) {
    if (!isPublicAddress(canonicalLiteral, isIP(canonicalLiteral))) {
      throw destinationDenied(hostname);
    }
    return;
  }
  if (
    !normalized.includes('.')
    || normalized === 'localhost'
    || LOCAL_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    throw destinationDenied(hostname);
  }
}

/**
 * Validate the exact address returned to the direct connector. This pins the
 * decision to the same DNS lookup used for the socket and closes DNS-rebinding
 * access to host and LAN services.
 */
export const sandboxEgressDnsLookup = ((
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => {
  lookup(hostname, options, (error, address, family) => {
    if (error) {
      callback(error, address, family);
      return;
    }
    const addresses: LookupAddress[] = Array.isArray(address)
      ? address
      : [{ address, family: family ?? isIP(address) }];
    if (
      !addresses.length
      || addresses.some((entry) => !isPublicAddress(entry.address, entry.family))
    ) {
      callback(destinationDenied(hostname), address, family);
      return;
    }
    callback(null, address, family);
  });
}) as unknown as typeof lookup;

function isPublicAddress(address: string, family: number): boolean {
  if (family !== 4 && family !== 6) return false;
  const normalized = canonicalNetworkAddress(address, family);
  if (family === 6 && normalized.startsWith('::ffff:')) return false;
  return !BLOCKED_ADDRESSES.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
}

function canonicalNetworkAddress(address: string, family: 4 | 6): string {
  try {
    const candidate = family === 6 ? `[${normalizeHostname(address)}]` : address;
    return normalizeHostname(new URL(`http://${candidate}/`).hostname);
  } catch {
    return normalizeHostname(address);
  }
}

function normalizeHostname(value: string): string {
  const unwrapped = value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value;
  return unwrapped.split('%', 1)[0]!.replace(/\.$/u, '').toLowerCase();
}

function canonicalIpLiteral(value: string): string | null {
  try {
    const candidate = value.includes(':') ? `[${value}]` : value;
    const canonical = normalizeHostname(new URL(`http://${candidate}/`).hostname);
    return isIP(canonical) ? canonical : null;
  } catch {
    return null;
  }
}

function destinationDenied(hostname: string): NodeJS.ErrnoException {
  return Object.assign(
    new Error(`Windows sandbox egress denied local or private destination: ${hostname}`),
    { code: 'EACCES' },
  );
}
