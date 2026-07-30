/**
 * The server, over a real stdio transport.
 *
 * `tools.test.ts` proves the behaviour. This proves the binding: that the tools
 * are actually registered, that their schemas accept what the descriptions say
 * they accept, that a refusal comes back as a tool error rather than killing the
 * process, and — the one that is easy to get wrong and impossible to notice —
 * that nothing writes human-readable output to stdout, which is the protocol
 * channel.
 *
 * It runs the server as a child process against a temporary SQLite registry,
 * driven by the SDK's own client, so the wire format is the SDK's problem rather
 * than something asserted by hand.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dir = mkdtempSync(join(tmpdir(), 'keel-mcp-server-'));

let client: Client;
let writable: Client;

/** Start a server against its own database, so the two cases cannot interfere. */
async function connect(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'mcp/server.ts'],
    env: {
      ...(process.env as Record<string, string>),
      KEEL_SQLITE_FILE: join(dir, `${env.TAG}.db`),
      ...env,
    },
  });
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(transport);
  return c;
}

/** Tool results are JSON as text; unwrap once here rather than at every call. */
function payload(result: unknown): { text: string; isError: boolean } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
}

const json = (result: unknown) => JSON.parse(payload(result).text);

beforeAll(async () => {
  client = await connect({ TAG: 'ro' });
  writable = await connect({ TAG: 'rw', KEEL_MCP_WRITE: '1', KEEL_MCP_IDENTITY: 'agent-under-test' });
}, 180_000);

afterAll(async () => {
  await client?.close();
  await writable?.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('the connection', () => {
  it('advertises the whole toolset', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'assess_change', 'compile', 'get_artifact', 'get_history', 'get_lineage',
      'get_parameters', 'get_rules', 'list_artifacts', 'preview_report',
      'save_artifact', 'test_rules', 'validate',
    ]);
  });

  it('describes each tool well enough to choose between them', async () => {
    // An agent picks a tool from its description. A one-word description is how
    // `save_artifact` gets called when `assess_change` was wanted.
    const tools = (await client.listTools()).tools;
    tools.forEach((t) => {
      expect(t.description!.length, t.name).toBeGreaterThan(80);
    });
  });

  it('says in the description itself when writing is disabled', async () => {
    // Rather than letting an agent discover it by trying — a refusal it could
    // have read about first is a wasted turn and a confusing one.
    const tools = (await client.listTools()).tools;
    const save = tools.find((t) => t.name === 'save_artifact')!;
    expect(save.description).toMatch(/read-only/);

    const writableSave = (await writable.listTools()).tools
      .find((t) => t.name === 'save_artifact')!;
    expect(writableSave.description).not.toMatch(/Disabled/);
  });
});

describe('reading over the wire', () => {
  it('lists the workspace', async () => {
    const out = json(await client.callTool({ name: 'list_artifacts', arguments: {} }));
    expect(out).toHaveLength(7);
    expect(out.map((a: { name: string }) => a.name)).toContain('fr2052a_product_id');
  });

  it('returns resolved rules, in order', async () => {
    const out = json(await client.callTool({
      name: 'get_rules',
      arguments: { name: 'fr2052a_product_id' },
    }));
    expect(out.rules[0].order).toBe(1);
    expect(out.rules[0].when).toBeTruthy();
    expect(out.column).toBe('product_id');
  });

  it('returns the chain a document sits in', async () => {
    const out = json(await client.callTool({
      name: 'get_lineage',
      arguments: { name: 'fr2052a_submission' },
    }));
    expect(out.chain.map((s: { label: string }) => s.label)).toContain('fr2052a_variance');
    expect(out.writes).toBe('reg.fr2052a_daily');
  });

  it('returns the whole graph when given no name', async () => {
    const out = json(await client.callTool({ name: 'get_lineage', arguments: {} }));
    expect(out.nodes).toHaveLength(7);
  });

  it('compiles to a semantic target', async () => {
    const out = json(await client.callTool({
      name: 'compile',
      arguments: { name: 'liquidity_pit', target: 'view' },
    }));
    expect(out.text).toContain('CREATE OR REPLACE VIEW');
    expect(out.published).toContain('lcr_pct');
  });
});

describe('refusing over the wire', () => {
  it('returns a tool error, not a dead process', async () => {
    const out = payload(await client.callTool({
      name: 'get_artifact', arguments: { name: 'nope' },
    }));
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/no artifact called nope/);

    // And the connection still works, which is the actual assertion.
    expect(json(await client.callTool({ name: 'list_artifacts', arguments: {} }))).toHaveLength(7);
  });

  it('refuses a save on a read-only connection', async () => {
    const body = json(await client.callTool({
      name: 'get_artifact', arguments: { name: 'liquidity_pit' },
    })).body as string;

    const out = payload(await client.callTool({
      name: 'save_artifact',
      arguments: { name: 'liquidity_pit', body: `${body}\n# x`, message: 'x' },
    }));
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/read-only/);
  });

  it('rejects arguments that do not match the schema', async () => {
    const out = payload(await client.callTool({
      name: 'compile',
      arguments: { name: 'liquidity_pit', target: 'cobol' },
    }));
    expect(out.isError).toBe(true);
  });
});

describe('the governance gate, end to end', () => {
  const loosen = async () => {
    const body = json(await writable.callTool({
      name: 'get_artifact', arguments: { name: 'fr2052a_variance' },
    })).body as string;
    return body.replace('limit: 1000000', 'limit: 5000000');
  };

  it('tells an agent what a change would silence before it makes it', async () => {
    const out = json(await writable.callTool({
      name: 'assess_change',
      arguments: { name: 'fr2052a_variance', body: await loosen() },
    }));
    expect(out.needsReview).toBe(true);
    expect(out.findings[0].summary).toMatch(/Silences/);
  });

  it('refuses the save, and the refusal says what to do', async () => {
    const out = payload(await writable.callTool({
      name: 'save_artifact',
      arguments: {
        name: 'fr2052a_variance', body: await loosen(), message: 'quieten the alert',
      },
    }));
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/acknowledgeReview: true/);
  });

  it('accepts it once acknowledged, and records that in the history', async () => {
    const saved = json(await writable.callTool({
      name: 'save_artifact',
      arguments: {
        name: 'fr2052a_variance',
        body: await loosen(),
        message: 'quieten the alert',
        acknowledgeReview: true,
      },
    }));
    expect(saved.revision).toBe(2);

    const history = json(await writable.callTool({
      name: 'get_history', arguments: { name: 'fr2052a_variance' },
    }));
    expect(history[0].message).toMatch(/review acknowledged/);
    // The identity is the server's, not something the call could set.
    expect(history[0].author).toBe('agent-under-test');
  });
});

describe('stdout belongs to the protocol', () => {
  it('puts the banner on stderr and leaves stdout clean', async () => {
    // A stray write to stdout corrupts the stream, and the failure surfaces
    // client-side as a JSON parse error that says nothing about where it came
    // from. Asserted on the real channels rather than by grepping the source:
    // start a server, say nothing to it, and see what each pipe holds.
    const { spawn } = await import('node:child_process');
    const child = spawn('npx', ['tsx', 'mcp/server.ts'], {
      env: { ...process.env, KEEL_SQLITE_FILE: join(dir, 'quiet.db') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { err += c.toString(); });

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      // The banner is written once the database is open, which is the last
      // thing before the transport takes the pipe.
      const timer = setInterval(() => {
        if (err.includes('keel-registry')) {
          clearInterval(timer);
          done();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(timer);
        done();
      }, 30_000);
    });

    child.kill('SIGTERM');
    expect(err).toMatch(/keel-registry .* read-only/);
    // Nothing at all before a request: every byte here would be one the client
    // has to parse as a protocol message.
    expect(out).toBe('');
  }, 60_000);
});
