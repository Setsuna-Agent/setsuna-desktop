import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

export type DesignPreviewBinding = Readonly<{ id: string; address: string }>;

export function listDesignPreviewBindings(): DesignPreviewBinding[] {
  try {
    const entries = Object.entries(networkInterfaces()).flatMap(([name, interfaces]) => (interfaces ?? []).flatMap((info) => {
      const { address, cidr, internal, mac } = info;
      const family = isIP(address);
      if (!family || address === '0.0.0.0' || address === '::') return [];
      // Scoped IPv6 addresses require the visitor's own adapter identifier in a URL.
      if (family === 6 && (address.includes('%') || /^fe[89ab][\da-f]:/iu.test(address))) return [];
      return [{ binding: { id: JSON.stringify([name, mac, address, cidr]), address }, internal, family }];
    }));
    return entries.sort((a, b) => Number(a.internal) - Number(b.internal) || a.family - b.family)
      .map(({ binding }) => binding);
  } catch {
    return [];
  }
}

export function designPreviewBindingKey(bindings: readonly DesignPreviewBinding[]) {
  return JSON.stringify(bindings.map(({ id }) => id).sort());
}

export function designPreviewEndpoints(bindings: readonly DesignPreviewBinding[], port: number, ipv6: boolean) {
  const endpoints = new Map<string, BlockList>();
  for (const { address } of bindings) {
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (family === 'ipv6' && !ipv6) continue;
    const hostname = family === 'ipv6' ? new URL(`http://[${address}]`).hostname : address;
    const authority = hostname + ':' + port;
    if (endpoints.has(authority)) continue;
    const endpoint = new BlockList();
    endpoint.addAddress(address, family);
    endpoints.set(authority, endpoint);
  }
  return endpoints;
}

export function matchesPreviewAddress(network: BlockList, address: string | undefined) {
  if (!address) return false;
  const family = isIP(address);
  return family !== 0 && network.check(address, family === 6 ? 'ipv6' : 'ipv4');
}
