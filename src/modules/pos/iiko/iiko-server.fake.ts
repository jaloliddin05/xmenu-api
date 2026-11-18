import { createServer, IncomingMessage, Server } from 'http';
import type { AddressInfo } from 'net';

export interface FakeIikoCall {
  path: string;
  authorization: string | undefined;
  body: any;
}

type Reply = { status?: number; body?: unknown };
type Handler = (call: FakeIikoCall) => Reply | undefined;

/** A JWT-shaped token iiko would issue: only `exp` is read. */
export function fakeIikoToken(expSeconds: number, tag = 't'): string {
  const enc = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: expSeconds, tag })}.sig`;
}

/**
 * In-process iiko Cloud API for unit tests: answers POST calls from per-path handlers and records
 * every call. Tests point IIKO_API_BASE_URL at `url`.
 */
export class FakeIikoServer {
  readonly calls: FakeIikoCall[] = [];
  private readonly handlers = new Map<string, Handler>();
  private server?: Server;
  url = '';

  on(path: string, handler: Handler | Reply): this {
    this.handlers.set(
      path,
      typeof handler === 'function' ? handler : () => handler,
    );
    return this;
  }

  callsTo(path: string): FakeIikoCall[] {
    return this.calls.filter((c) => c.path === path);
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void readBody(req).then((raw) => {
        const call: FakeIikoCall = {
          path: req.url ?? '',
          authorization: req.headers.authorization,
          body: raw ? JSON.parse(raw) : undefined,
        };
        this.calls.push(call);
        const reply = this.handlers.get(call.path)?.(call) ?? {
          status: 404,
          body: { errorDescription: 'not found', correlationId: 'x' },
        };
        res.writeHead(reply.status ?? 200, {
          'content-type': 'application/json',
        });
        res.end(JSON.stringify(reply.body ?? {}));
      });
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => resolve(raw));
  });
}
