import { EventEmitter } from 'events';
import { get } from 'http';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

export interface SseFrame {
  id?: string;
  event?: string;
  data?: Record<string, unknown>;
  comment?: string;
}

/** Splits SSE text into frames (comments included), as a browser would. */
export function parseSse(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    const f: SseFrame = {};
    for (const line of block.split('\n')) {
      if (line.startsWith(': ')) f.comment = line.slice(2);
      else if (line.startsWith('id: ')) f.id = line.slice(4);
      else if (line.startsWith('event: ')) f.event = line.slice(7);
      else if (line.startsWith('data: '))
        f.data = JSON.parse(line.slice(6)) as Record<string, unknown>;
    }
    if (f.id || f.event || f.data || f.comment) frames.push(f);
  }
  return frames;
}

/** A real HTTP stream to a listening app (supertest buffers until the end, a stream never ends). */
export function openStream(
  server: Server,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  frames: () => SseFrame[];
  body: () => string;
  waitFor: (
    pred: (f: SseFrame[]) => boolean,
    ms?: number,
  ) => Promise<SseFrame[]>;
  ended: () => boolean;
  close: () => void;
}> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let text = '';
      let ended = false;
      const changed = new EventEmitter();
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
        changed.emit('x');
      });
      res.on('end', () => {
        ended = true;
        changed.emit('x');
      });
      const frames = () => parseSse(text);
      resolve({
        status: res.statusCode ?? 0,
        frames,
        body: () => text,
        ended: () => ended,
        close: () => req.destroy(),
        waitFor: (pred, ms = 3000) =>
          new Promise((ok, fail) => {
            const check = () => {
              if (pred(frames())) {
                clearTimeout(timer);
                changed.off('x', check);
                ok(frames());
              }
            };
            const timer = setTimeout(() => {
              changed.off('x', check);
              fail(new Error(`stream did not get there: ${text}`));
            }, ms);
            changed.on('x', check);
            check();
          }),
      });
    });
    req.on('error', reject);
  });
}
