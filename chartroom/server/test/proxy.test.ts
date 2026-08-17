/**
 * The chat proxy (ADR-36): frames pass through untouched, and an unreachable
 * agent service degrades to the honest `unavailable` frame the studio's
 * banner expects — never a 502. The loop itself lives in chartroom-agent and
 * is tested there (pytest); the entitlement assertions the Phase-6 chat tests
 * carried migrated with it.
 */

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatFrames } from '../src/proxy';

const PORT = 8400 + (process.pid % 90);
let fakeAgent: Server;

beforeAll(async () => {
  // A stand-in agent service that speaks two frames and closes.
  fakeAgent = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"type":"text","delta":"hello"}\n\n');
    res.write('data: {"type":"done","stop_reason":"end_turn"}\n\n');
    res.end();
  });
  await new Promise<void>((resolve) => fakeAgent.listen(PORT, resolve));
});

afterAll(async () => {
  await new Promise((resolve) => fakeAgent.close(resolve));
  delete process.env.CHARTROOM_AGENT_URL;
});

const collect = async (body: unknown): Promise<string> => {
  let out = '';
  for await (const chunk of chatFrames(body)) out += chunk;
  return out;
};

describe('the chat proxy', () => {
  it('streams the agent service frames through byte-untouched', async () => {
    process.env.CHARTROOM_AGENT_URL = `http://127.0.0.1:${PORT}`;
    const out = await collect({ message: 'hi' });
    expect(out).toBe(
      'data: {"type":"text","delta":"hello"}\n\n'
      + 'data: {"type":"done","stop_reason":"end_turn"}\n\n',
    );
  });

  it('an unreachable service is a banner, not a 502', async () => {
    process.env.CHARTROOM_AGENT_URL = 'http://127.0.0.1:9';
    const out = await collect({ message: 'hi' });
    const event = JSON.parse(out.slice('data: '.length, -2)) as { type: string; message: string };
    expect(event.type).toBe('unavailable');
    // The pane's e2e asserts this word — part of the frozen contract.
    expect(event.message).toContain('deterministic');
  });
});
