import { createSocket, RemoteInfo, Socket } from 'node:dgram';

/**
 * A tiny UDP DNS server for tests: answers TXT questions from `records` (name -> values), NXDOMAIN
 * for any other name. The same idea as the fake DNS of the e2e stack (DOMAIN_VERIFY_DNS_SERVERS).
 */
export class FakeDnsServer {
  readonly records = new Map<string, string[]>();
  readonly asked: string[] = [];
  private socket?: Socket;

  async start(): Promise<string> {
    const socket = createSocket('udp4');
    this.socket = socket;
    socket.on('message', (msg, peer) => this.answer(msg, peer));
    await new Promise<void>((resolve) =>
      socket.bind(0, '127.0.0.1', () => resolve()),
    );
    return `127.0.0.1:${socket.address().port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) =>
      this.socket ? this.socket.close(() => resolve()) : resolve(),
    );
  }

  private answer(query: Buffer, peer: RemoteInfo) {
    // Question: labels from offset 12 up to the zero byte, then QTYPE and QCLASS
    const labels: string[] = [];
    let at = 12;
    while (query[at] !== 0) {
      labels.push(query.toString('ascii', at + 1, at + 1 + query[at]));
      at += query[at] + 1;
    }
    const questionEnd = at + 5;
    const name = labels.join('.').toLowerCase();
    const type = query.readUInt16BE(at + 1);
    this.asked.push(name);
    const values = type === 16 ? this.records.get(name) : undefined;

    const header = Buffer.alloc(12);
    query.copy(header, 0, 0, 2); // id
    header.writeUInt16BE(values ? 0x8180 : 0x8183, 2); // response, recursion; rcode 0 or NXDOMAIN
    header.writeUInt16BE(1, 4); // one question
    header.writeUInt16BE(values?.length ?? 0, 6);
    const answers = (values ?? []).map((value) => {
      const text = Buffer.from(value, 'utf8');
      const rr = Buffer.alloc(12);
      rr.writeUInt16BE(0xc00c, 0); // name: pointer to the question
      rr.writeUInt16BE(16, 2); // TXT
      rr.writeUInt16BE(1, 4); // IN
      rr.writeUInt32BE(60, 6); // TTL
      rr.writeUInt16BE(text.length + 1, 10);
      return Buffer.concat([rr, Buffer.from([text.length]), text]);
    });
    const reply = Buffer.concat([
      header,
      query.subarray(12, questionEnd),
      ...answers,
    ]);
    this.socket?.send(reply, peer.port, peer.address);
  }
}
