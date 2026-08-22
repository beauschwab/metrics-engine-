/**
 * The definition-agent proxy (ADR-56).
 *
 * Three postures, each ending in at least one frame: the service is there and
 * its frames pass through untouched; the service is absent and the client gets
 * the honest `unavailable` event; the service answers with a failure status
 * and the client gets the same event rather than a decorated 502.
 *
 * The fake agent claims its own OS-assigned port — a fixed port here would
 * collide with a real agent service someone left running, and the failure
 * would surface as this suite asserting against that process's frames.
 */

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatFrames } from './agent';

let server: Server;
let port: number;

/** What the fake agent should do for the next request. */
let mode: 'stream' | 'fail' = 'stream';

const collect = async (body: unknown): Promise<string[]> => {
  const out: string[] = [];
  for await (const chunk of chatFrames(body)) out.push(chunk);
  return out;
};

const events = (chunks: string[]): Array<Record<string, unknown>> =>
  chunks
    .join('')
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>);

beforeAll(async () => {
  server = createServer((_req, res) => {
    if (mode === 'fail') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // Two frames in the frozen framing, then done — enough to prove the
    // proxy neither reframes nor buffers-and-reorders.
    res.write('data: {"type":"text","delta":"governed "}\n\n');
    res.write('data: {"type":"text","delta":"hello"}\n\n');
    res.end('data: {"type":"done","stop_reason":"end_turn"}\n\n');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  process.env.KEEL_AGENT_URL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.KEEL_AGENT_URL;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('the definition-agent proxy', () => {
  it('passes the agent frames through untouched', async () => {
    mode = 'stream';
    const out = events(await collect({ message: 'hi' }));
    expect(out.map((e) => e.type)).toEqual(['text', 'text', 'done']);
    expect(out[0].delta).toBe('governed ');
  });

  it('degrades to the unavailable event when the service is absent', async () => {
    process.env.KEEL_AGENT_URL = `http://127.0.0.1:1`; // nothing listens on port 1
    try {
      const out = events(await collect({ message: 'hi' }));
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe('unavailable');
      expect(out[0].message).toMatch(/AGENT_SURFACE=registry/);
      expect(out[0].message).toMatch(/deterministic/);
    } finally {
      process.env.KEEL_AGENT_URL = `http://127.0.0.1:${port}`;
    }
  });

  it('treats a failing service as absent, never as a 502 to decorate', async () => {
    mode = 'fail';
    const out = events(await collect({ message: 'hi' }));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('unavailable');
  });
});
