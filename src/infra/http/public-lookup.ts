import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isPublicAddress } from './internal-request';

/** An outgoing request was refused because its host is, or resolves to, an address that is not public. */
export class BlockedAddressError extends Error {}

/**
 * DNS lookup for the agent of an outgoing request to an address from external data: resolves every address of the
 * host and refuses the connection if any of them is not public (isPublicAddress), so a name that points inside the
 * server network (or rebinds to it between two lookups) never connects. The socket uses the checked answer.
 */
export function publicOnlyLookup(
  resolve: LookupFunction = dnsLookup as LookupFunction,
): LookupFunction {
  return (hostname, options: LookupOptions, callback) => {
    resolve(hostname, { ...options, all: true }, (err, answer) => {
      if (err) return callback(err, '', 0);
      const addresses: LookupAddress[] = Array.isArray(answer) ? answer : [];
      if (
        !addresses.length ||
        addresses.some((a) => !isPublicAddress(a.address))
      )
        return callback(
          new BlockedAddressError(
            `${hostname} resolves to a non-public address`,
          ),
          '',
          0,
        );
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
