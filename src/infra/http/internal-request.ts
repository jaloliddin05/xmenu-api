import { BlockList, isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

// Headers every reverse proxy in front of the API adds (Caddy always sets the X-Forwarded-* trio)
const PROXY_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
] as const;

const PRIVATE = new BlockList();
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');

/** Loopback or a private (RFC 1918, unique local) address; IPv4-mapped IPv6 is unwrapped. */
export function isPrivateAddress(raw: string | undefined): boolean {
  if (!raw) return false;
  const address = raw.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const version = isIP(address);
  if (!version) return false;
  return PRIVATE.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * A request made inside the server's private network, not passed through the public proxy: the TCP peer
 * (never X-Forwarded-For, whatever `trust proxy` says) is a private address, and the request carries none of
 * the headers a reverse proxy adds. Caddy's on-demand TLS `ask` calls the API directly, without them.
 */
export function isInternalRequest(req: {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string };
}): boolean {
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  return isPrivateAddress(req.socket.remoteAddress);
}
