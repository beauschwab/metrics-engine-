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
import { VIEW_FILES } from 'keel-engine/documents';

const dir = mkdtempSync(join(tmpdir(), 'keel-mcp-server-'));

let client: Client;
let writable: Client;
let agent: Client;

/** Start a server against its own database, so the two cases cannot interfere. */
async function connect(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'server.ts'],
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
  // A model session's connection — the write flag is deliberately ON, because
  // the point is that it does not matter (ADR-56).
  agent = await connect({ TAG: 'agent', KEEL_MCP_WRITE: '1', KEEL_MCP_IDENTITY: 'agent:lg-registry' });
}, 180_000);

afterAll(async () => {
  await client?.close();
  await writable?.close();
  await agent?.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('the connection', () => {
  it('advertises the whole toolset', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'assess_change', 'compile', 'create_release', 'get_artifact', 'get_history',
      'get_lineage', 'get_manifest', 'get_parameters', 'get_release', 'get_rules',
      'list_artifacts', 'list_channels', 'list_releases', 'preview_report', 'promote',
      'save_artifact', 'test_rules', 'validate',
    ]);
  });

  it('never even offers the write tools to an agent identity', async () => {
    // Not present-but-refused: absent. A tool that exists is a permission that
    // could be granted later, which is exactly what the maker-checker seam
    // forbids for a model session (ADR-56). Everything else — including the
    // release and channel reads — is still there.
    const names = (await agent.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'assess_change', 'compile', 'get_artifact', 'get_history',
      'get_lineage', 'get_manifest', 'get_parameters', 'get_release', 'get_rules',
      'list_artifacts', 'list_channels', 'list_releases', 'preview_report',
      'test_rules', 'validate',
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
    expect(out).toHaveLength(VIEW_FILES.length);
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
    expect(out.nodes).toHaveLength(VIEW_FILES.length);
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
    expect(json(await client.callTool({ name: 'list_artifacts', arguments: {} })))
      .toHaveLength(VIEW_FILES.length);
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

describe('releasing and deploying over the wire', () => {
  it('refuses to cut or deploy on a read-only connection', async () => {
    const cut = payload(await client.callTool({
      name: 'create_release', arguments: { message: 'nope' },
    }));
    expect(cut.isError).toBe(true);
    expect(cut.text).toMatch(/read-only/);

    const deploy = payload(await client.callTool({
      name: 'promote', arguments: { channel: 'production', version: 1, message: 'nope' },
    }));
    expect(deploy.isError).toBe(true);
    expect(deploy.text).toMatch(/read-only/);
  });

  it('cuts, deploys, and then serves a manifest a client can poll', async () => {
    const release = json(await writable.callTool({
      name: 'create_release', arguments: { message: 'first deployable' },
    }));
    expect(release.version).toBeGreaterThan(0);
    expect(release.artifacts).toBe(VIEW_FILES.length);

    const promoted = json(await writable.callTool({
      name: 'promote',
      arguments: { channel: 'production', version: release.version, message: 'go live' },
    }));
    expect(promoted.channel.version).toBe(release.version);

    const manifest = json(await writable.callTool({
      name: 'get_manifest', arguments: { channel: 'production' },
    }));
    expect(manifest.release.version).toBe(release.version);
    expect(manifest.artifacts).toHaveLength(VIEW_FILES.length);
    // The stage is on every entry, so a client can tell a pipeline stage from a
    // dashboard ratio without re-deriving it.
    expect(manifest.artifacts.every((a: { stage: string }) => !!a.stage)).toBe(true);
  });

  it('refuses a deployment that weakens what the channel serves', async () => {
    // The gate at the moment it matters most.
    //
    // Self-contained on purpose: earlier tests in this file have already
    // loosened this threshold, so the baseline is established here rather than
    // assumed. A governance test that only passes in file order is a governance
    // test that will one day pass for the wrong reason.
    const setLimit = async (limit: string) => {
      const body = json(await writable.callTool({
        name: 'get_artifact', arguments: { name: 'fr2052a_variance' },
      })).body as string;
      await writable.callTool({
        name: 'save_artifact',
        arguments: {
          name: 'fr2052a_variance',
          body: body.replace(/limit: \d+/, `limit: ${limit}`),
          message: `limit ${limit}`,
          acknowledgeReview: true,
        },
      });
      return json(await writable.callTool({
        name: 'create_release', arguments: { message: `limit ${limit}` },
      })).version as number;
    };

    // Baseline: the tight threshold, deployed.
    const tight = await setLimit('1000000');
    await writable.callTool({
      name: 'promote',
      arguments: {
        channel: 'staging', version: tight, message: 'baseline', acknowledgeReview: true,
      },
    });

    const loosened = await setLimit('5000000');
    const refused = payload(await writable.callTool({
      name: 'promote',
      arguments: { channel: 'staging', version: loosened, message: 'ship it' },
    }));
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/Silences 3 breaches/);

    const accepted = json(await writable.callTool({
      name: 'promote',
      arguments: {
        channel: 'staging', version: loosened,
        message: 'ship it', acknowledgeReview: true,
      },
    }));
    expect(accepted.channel.version).toBe(loosened);
  });

  it('says what each channel serves', async () => {
    const channels = json(await writable.callTool({ name: 'list_channels', arguments: {} }));
    const names = channels.map((c: { name: string }) => c.name);
    expect(names).toContain('production');
    expect(names).toContain('staging');
  });
});

describe('stdout belongs to the protocol', () => {
  it('puts the banner on stderr and leaves stdout clean', async () => {
    // A stray write to stdout corrupts the stream, and the failure surfaces
    // client-side as a JSON parse error that says nothing about where it came
    // from. Asserted on the real channels rather than by grepping the source:
    // start a server, say nothing to it, and see what each pipe holds.
    const { spawn } = await import('node:child_process');
    const child = spawn('npx', ['tsx', 'server.ts'], {
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
