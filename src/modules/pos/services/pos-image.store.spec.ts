import { createServer, Server } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { rmSync } from 'fs';
import { join } from 'path';
import { BlockedAddressError } from 'src/infra/http/public-lookup';
import { imageHostAllowed, PosImageStore } from './pos-image.store';

// A 1x1 PNG: the header is what the image sniffing looks at
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000',
  'hex',
);

/** A local HTTP server: `/pic.png` answers a picture, `/go?to=<url>` redirects there. */
async function listen(): Promise<{
  server: Server;
  origin: string;
  hits: string[];
}> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? '');
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/go') {
      res.writeHead(302, { location: url.searchParams.get('to') ?? '/' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}`, hits };
}

/** A resolver that answers `address` for every name and records the names. */
function fakeDns(address: string, family = 4) {
  const names: string[] = [];
  const lookup = ((
    hostname: string,
    _opts: unknown,
    cb: (...a: unknown[]) => void,
  ) => {
    names.push(hostname);
    cb(null, [{ address, family }]);
  }) as unknown as LookupFunction;
  return { lookup, names };
}

describe('PosImageStore (SSRF)', () => {
  const env = { ...process.env };
  let local: Awaited<ReturnType<typeof listen>>;
  let other: Awaited<ReturnType<typeof listen>>;
  let store: PosImageStore;

  beforeAll(async () => {
    local = await listen();
    other = await listen();
  });
  afterAll(async () => {
    await new Promise((r) => local.server.close(r));
    await new Promise((r) => other.server.close(r));
    rmSync(join('uploads', 'image', 'products', 'pos'), {
      recursive: true,
      force: true,
    });
  });
  beforeEach(() => {
    process.env = { ...env, NODE_ENV: 'test' };
    delete process.env.IIKO_IMAGE_HOSTS;
    delete process.env.IIKO_API_BASE_URL;
    store = new PosImageStore();
    local.hits.length = 0;
    other.hits.length = 0;
  });
  afterAll(() => {
    process.env = env;
  });

  it.each([
    'http://127.0.0.1/a.png',
    'http://10.0.0.5/a.png',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.1.1/a.png',
    'http://0.0.0.0/a.png',
    'http://[::1]/a.png',
    'http://[::ffff:127.0.0.1]/a.png',
    'http://[fe80::1]/a.png',
  ])('refuses the internal address %s before connecting', async (url) => {
    await expect(store.fetch(url)).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('refuses a local server that is not the trusted fake iiko', async () => {
    await expect(store.fetch(`${local.origin}/pic.png`)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    expect(local.hits).toEqual([]);
  });

  it('refuses a name that resolves to a private address', async () => {
    const dns = fakeDns('10.1.2.3');
    store.resolve = dns.lookup;
    await expect(
      store.fetch('http://pics.example.com/a.png'),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    expect(dns.names).toEqual(['pics.example.com']);
  });

  it('refuses a name that resolves to an IPv4-mapped loopback', async () => {
    store.resolve = fakeDns('::ffff:127.0.0.1', 6).lookup;
    await expect(
      store.fetch('http://pics.example.com/a.png'),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('checks every redirect again: a redirect to an internal address is not followed', async () => {
    process.env.IIKO_API_BASE_URL = local.origin;
    const to = encodeURIComponent(`${other.origin}/pic.png`);
    await expect(
      store.fetch(`${local.origin}/go?to=${to}`),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    expect(local.hits).toHaveLength(1);
    expect(other.hits).toEqual([]);
  });

  it('a redirect to cloud metadata is not followed', async () => {
    process.env.IIKO_API_BASE_URL = local.origin;
    const to = encodeURIComponent('http://169.254.169.254/latest/meta-data');
    await expect(
      store.fetch(`${local.origin}/go?to=${to}`),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('stops after three redirects', async () => {
    process.env.IIKO_API_BASE_URL = local.origin;
    let url = `${local.origin}/pic.png`;
    for (let i = 0; i < 4; i++)
      url = `${local.origin}/go?to=${encodeURIComponent(url)}`;
    await expect(store.fetch(url)).rejects.toThrow('too many');
  });

  it('follows up to three redirects within allowed addresses and stores the picture', async () => {
    process.env.IIKO_API_BASE_URL = local.origin;
    const to = encodeURIComponent(`${local.origin}/pic.png`);
    const stored = await store.fetch(`${local.origin}/go?to=${to}`);
    expect(stored.path).toMatch(/\.png$/);
    expect(local.hits).toEqual([expect.stringMatching(/^\/go/), '/pic.png']);
  });

  it('IIKO_IMAGE_HOSTS: a host off the list is refused before any lookup', async () => {
    process.env.IIKO_IMAGE_HOSTS = 'img.iiko.example, *.cdn.example';
    const dns = fakeDns('10.0.0.1');
    store.resolve = dns.lookup;
    await expect(store.fetch('https://evil.example/a.png')).rejects.toThrow(
      'allowed list',
    );
    expect(dns.names).toEqual([]);
  });

  it('IIKO_IMAGE_HOSTS: a listed host still goes through the address check', async () => {
    process.env.IIKO_IMAGE_HOSTS = '*.cdn.example';
    const dns = fakeDns('192.168.0.10');
    store.resolve = dns.lookup;
    await expect(
      store.fetch('http://a.cdn.example/a.png'),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    expect(dns.names).toEqual(['a.cdn.example']);
  });

  it('IIKO_IMAGE_HOSTS: a listed host is downloaded', async () => {
    process.env.IIKO_API_BASE_URL = local.origin;
    process.env.IIKO_IMAGE_HOSTS = '127.0.0.1';
    await expect(store.fetch(`${local.origin}/pic.png`)).resolves.toMatchObject(
      {
        path: expect.stringMatching(/\.png$/),
      },
    );
  });

  it('production: http is refused and the fake iiko is not trusted', async () => {
    process.env.NODE_ENV = 'production';
    process.env.IIKO_API_BASE_URL = local.origin;
    await expect(store.fetch(`${local.origin}/pic.png`)).rejects.toThrow(
      'https',
    );
    await expect(
      store.fetch(`https://127.0.0.1:${new URL(local.origin).port}/pic.png`),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    expect(local.hits).toEqual([]);
  });
});

describe('imageHostAllowed', () => {
  it.each([
    ['img.iiko.example', ['img.iiko.example'], true],
    ['IMG.iiko.example.', ['img.iiko.example'], true],
    ['a.cdn.example', ['*.cdn.example'], true],
    ['cdn.example', ['*.cdn.example'], false],
    ['evilcdn.example', ['*.cdn.example'], false],
    ['other.example', ['img.iiko.example'], false],
    ['anything.example', [], true],
  ])('%s with %j → %s', (host, list, expected) => {
    expect(imageHostAllowed(host, list)).toBe(expected);
  });
});
