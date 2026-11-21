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

// Everything an outgoing request to an address from external data (iiko menu pictures) must never reach, on top
// of PRIVATE: "this network", carrier-grade NAT, link-local (cloud metadata), multicast, reserved and broadcast,
// the unspecified IPv6 address, IPv6 link-local and multicast. IPv4-mapped IPv6 is checked as IPv4.
const NOT_PUBLIC = new BlockList();
NOT_PUBLIC.addSubnet('0.0.0.0', 8, 'ipv4');
NOT_PUBLIC.addSubnet('100.64.0.0', 10, 'ipv4');
NOT_PUBLIC.addSubnet('169.254.0.0', 16, 'ipv4');
NOT_PUBLIC.addSubnet('224.0.0.0', 4, 'ipv4');
NOT_PUBLIC.addSubnet('240.0.0.0', 4, 'ipv4');
NOT_PUBLIC.addAddress('::', 'ipv6');
NOT_PUBLIC.addSubnet('fe80::', 10, 'ipv6');
NOT_PUBLIC.addSubnet('ff00::', 8, 'ipv6');

/** `::ffff:a.b.c.d` and `::ffff:XXXX:XXXX` as the IPv4 address they carry; anything else unchanged. */
function unwrapMappedIpv4(address: string): string {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex) return address;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

/**
 * Whether an outgoing request may go to this IP: a valid address that is not loopback, private, link-local, CGNAT,
 * "this network", multicast, reserved or broadcast (IPv4-mapped IPv6 is judged as the IPv4 inside). Not an IP: false.
 */
export function isPublicAddress(raw: string | undefined): boolean {
  if (!raw) return false;
  const address = unwrapMappedIpv4(raw.replace(/^\[|\]$/g, ''));
  const version = isIP(address);
  if (!version) return false;
  const type = version === 4 ? 'ipv4' : 'ipv6';
  if (type === 'ipv6' && /^::ffff:/i.test(address)) return false;
  return !PRIVATE.check(address, type) && !NOT_PUBLIC.check(address, type);
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
