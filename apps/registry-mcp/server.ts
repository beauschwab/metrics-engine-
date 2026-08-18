/**
 * The registry as an MCP server.
 *
 * A thin binding of `tools.ts` to the protocol — schemas in, JSON out. Nothing
 * here decides anything: the policy, the refusals and the governance checks all
 * live in the tool layer where they can be tested without a subprocess.
 *
 *   npm run mcp                      # read-only, SQLite
 *   KEEL_MCP_WRITE=1 npm run mcp     # writes allowed
 *
 * Tool descriptions are written for the model that will read them, which means
 * they say what a tool is *for* and when not to reach for it. An agent that
 * calls `save_artifact` when it wanted `assess_change` has done something with
 * consequences; the descriptions are part of stopping that.
 */

import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { migrate, openMssql, openSqlite, type Db } from 'keel-registry/db';
import { dialectFor, type DialectName } from 'keel-registry/dialect';
import { Repository } from 'keel-registry/repository';
import { shippedDocuments } from 'keel-registry/index';
import {
  ToolError, assessProposed, compile, createRelease, getArtifact, getHistory,
  getLineage, getLineageGraph, getManifest, getParameters, getRelease, getRules,
  listArtifacts, listChannels, listReleases, policyFromEnv, previewReport, promote,
  saveArtifact, testRules, validate, type McpPolicy,
} from './tools';

const NAME = 'keel-registry';
const VERSION = '0.1.0';

/** Every tool returns JSON as text — one shape, so a client never has to branch. */
type Content = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (value: unknown): Content => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

/**
 * A refusal is a result, not a crash.
 *
 * `ToolError` is the class of thing the caller can act on — a name that does not
 * exist, a save that needs acknowledging, a read-only connection. Those come
 * back as tool errors with their message intact so the agent can respond;
 * anything else is a bug and is reported as one rather than dressed up.
 */
async function attempt(fn: () => Promise<unknown>): Promise<Content> {
  try {
    return ok(await fn());
  } catch (err) {
    const message = err instanceof ToolError
      ? err.message
      : `internal error: ${err instanceof Error ? err.message : String(err)}`;
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

async function connect(): Promise<Db> {
  const which = (process.env.KEEL_DB || 'sqlite') as DialectName;
  const dialect = dialectFor(which);
  if (which === 'mssql') {
    const required = (n: string) => {
      const v = process.env[n];
      if (!v) throw new Error(`${n} is required when KEEL_DB=mssql`);
      return v;
    };
    return openMssql({
      server: required('KEEL_MSSQL_SERVER'),
      database: required('KEEL_MSSQL_DATABASE'),
      user: process.env.KEEL_MSSQL_USER,
      password: process.env.KEEL_MSSQL_PASSWORD,
      encrypt: process.env.KEEL_MSSQL_ENCRYPT !== 'false',
      trustServerCertificate: process.env.KEEL_MSSQL_TRUST_CERT === 'true',
    }, dialect);
  }
  return openSqlite(process.env.KEEL_SQLITE_FILE || 'keel.db', dialect);
}

export function register(server: McpServer, repo: Repository, policy: McpPolicy): void {
  // --- reading -------------------------------------------------------------

  server.tool(
    'list_artifacts',
    'List every governed document in the registry with its kind, pipeline stage '
    + '(prepare / file / publish / watch), governance tier, owner, current revision, '
    + 'and what it reads and writes. Start here — the stage and runtime are what '
    + 'distinguish a dashboard ratio from a pipeline enrichment stage, which share a kind.',
    {},
    () => attempt(() => listArtifacts(repo)),
  );

  server.tool(
    'get_artifact',
    'Fetch one document\'s full body and metadata. Pass `revision` to read a '
    + 'historical version — revisions are append-only, so this is how you answer '
    + '"what were the rules when we filed on that date".',
    {
      name: z.string().describe('Artifact name, e.g. fr2052a_product_id'),
      revision: z.number().int().positive().optional()
        .describe('Specific revision; omit for the current one'),
    },
    ({ name, revision }) => attempt(() => getArtifact(repo, name, revision)),
  );

  server.tool(
    'get_history',
    'The revision history of one document: who changed it, when, with what message. '
    + 'Use this before proposing an edit — a rule that three people have already '
    + 'tuned is one to be careful with.',
    { name: z.string() },
    ({ name }) => attempt(() => getHistory(repo, name)),
  );

  server.tool(
    'get_rules',
    'The resolved rule set for a classification: every rule in evaluation order '
    + 'with its condition, the value it emits, its citation, and how much of the '
    + 'test book it claims. Prefer this over reading the raw document — first-match '
    + 'precedence means a rule\'s position is part of its meaning, and this returns '
    + 'the semantics rather than the YAML.',
    {
      name: z.string().describe('Classification name, e.g. fr2052a_product_id'),
      asOf: z.string().optional()
        .describe('ISO date; rule sets are effective-dated, so this selects the version in force'),
    },
    ({ name, asOf }) => attempt(() => getRules(repo, name, policy, asOf)),
  );

  server.tool(
    'get_parameters',
    'The resolved entries of a governed rate table — each key, its value, and the '
    + 'citation behind it — as in force on a date.',
    { name: z.string(), asOf: z.string().optional() },
    ({ name, asOf }) => attempt(() => getParameters(repo, name, asOf)),
  );

  server.tool(
    'get_lineage',
    'What feeds what. With a name: that document\'s stage, where it runs, the '
    + 'source table it reads, the table it writes, what it uses, what uses it, and '
    + 'the full chain it sits in. Without a name: every document and its edges. '
    + 'Call this before editing anything — `usedBy` is the list of things that break.',
    { name: z.string().optional() },
    ({ name }) => attempt(() => (name ? getLineage(repo, name) : getLineageGraph(repo))),
  );

  server.tool(
    'compile',
    'Compile a document to an execution target. `sql`, `polars` and `pyspark` are '
    + 'the pipeline plans; `view` emits a CREATE OR REPLACE VIEW and `dbt` a '
    + 'semantic model, for wiring a dashboard to the governed definition instead of '
    + 'retyping it. Pass `body` to compile a proposed edit without saving it.',
    {
      name: z.string(),
      target: z.enum(['sql', 'polars', 'pyspark', 'view', 'dbt']),
      body: z.string().optional().describe('Proposed body; omit to compile what is stored'),
    },
    ({ name, target, body }) => attempt(() => compile(repo, name, target, body)),
  );

  // --- authoring and testing, without writing ------------------------------

  server.tool(
    'validate',
    'Run the full diagnostic catalogue against a proposed document body without '
    + 'saving it. Same checks a human author is held to. Errors here will block a '
    + 'save, so call this first.',
    {
      name: z.string(),
      body: z.string().describe('The proposed document, in full'),
    },
    ({ name, body }) => attempt(() => validate(repo, name, body, policy)),
  );

  server.tool(
    'test_rules',
    'Run a rule set over the test book and report what it does: records and '
    + 'notional per rule, which rules fire on nothing, which are pre-empted by an '
    + 'earlier rule, and — most importantly — how many records match no rule at all. '
    + 'Pass `body` to test a proposed version. Nothing is written.',
    {
      name: z.string().describe('Classification name'),
      body: z.string().optional().describe('Proposed body; omit to test what is stored'),
    },
    ({ name, body }) => attempt(() => testRules(repo, name, policy, body)),
  );

  server.tool(
    'preview_report',
    'The rows a report would file, computed from the test book. Pass `edits` as a '
    + '{name: body} map to see the effect of changes to any documents in the chain '
    + 'without saving them.',
    {
      name: z.string(),
      edits: z.record(z.string()).optional(),
    },
    ({ name, edits }) => attempt(() => previewReport(repo, name, policy, edits)),
  );

  server.tool(
    'assess_change',
    'What a proposed edit would DO, by running both versions and comparing. Reports '
    + 'breaches a threshold change would silence, records a rule change would '
    + 'reclassify, dimensions a report would stop splitting by, and rates that moved '
    + 'without their citation moving. Call this before any save: `needsReview: true` '
    + 'means the change weakens something and the save will refuse without an '
    + 'explicit acknowledgement.',
    {
      name: z.string(),
      body: z.string().describe('The proposed document, in full'),
    },
    ({ name, body }) => attempt(() => assessProposed(repo, name, body, policy)),
  );

  // --- writing -------------------------------------------------------------

  // --- releasing and deploying --------------------------------------------

  server.tool(
    'list_releases',
    'Every release ever cut, newest first, with the diagnostic counts recorded '
    + 'at cut time. A release is an immutable snapshot of every artifact at one '
    + 'revision — editing afterwards changes nothing any deployed client reads.',
    {},
    () => attempt(() => listReleases(repo)),
  );

  server.tool(
    'get_release',
    'One release with its pins: which revision of each artifact it froze. Use '
    + 'this to answer "exactly what was deployed" for a given version.',
    { version: z.number().int().positive() },
    ({ version }) => attempt(() => getRelease(repo, version)),
  );

  server.tool(
    'list_channels',
    'What each channel (production, staging…) currently serves, and its recent '
    + 'promotion history. A channel is what runtime clients dereference; they '
    + 'never name a release directly.',
    {},
    () => attempt(() => listChannels(repo)),
  );

  server.tool(
    'get_manifest',
    'What a channel serves right now: release version, and every artifact with '
    + 'its pinned revision and content hash. This is the poll target for a '
    + 'runtime client — cache everything else against release.version.',
    { channel: z.string() },
    ({ channel }) => attempt(() => getManifest(repo, channel)),
  );

  server.tool(
    'create_release',
    policy.canWrite
      ? 'Cut a release from the current workspace, pinning every artifact at its '
        + 'current revision. Records the diagnostic counts rather than gating on '
        + 'them; refuses only if a document does not parse. Cutting does not '
        + 'deploy — use promote for that.'
      : 'Disabled: this registry connection is read-only. Set KEEL_MCP_WRITE=1 to '
        + 'cut releases. You can still read what has been released with '
        + 'list_releases and get_release, and see what is deployed with get_manifest.',
    {
      message: z.string().describe('Why this release is being cut — it lands in the record'),
      name: z.string().optional().describe('Optional human label, e.g. "Q3 rates"'),
    },
    (args) => attempt(() => createRelease(repo, policy, args)),
  );

  server.tool(
    'promote',
    policy.canWrite
      ? 'Point a channel at a release — this is the moment production changes. '
        + 'Runs the impact assessment against what the channel currently serves '
        + 'and REFUSES anything that weakens a control or restates filed history '
        + 'unless acknowledgeReview is set; the acknowledgement is recorded '
        + 'against the promotion. Rolling back is promoting an older version, '
        + 'and is judged the same way.'
      : 'Disabled: this registry connection is read-only. Set KEEL_MCP_WRITE=1 to '
        + 'deploy. You can still inspect what each channel serves with '
        + 'list_channels and get_manifest, and compare releases with get_release.',
    {
      channel: z.string().describe('e.g. production, staging'),
      version: z.number().int().positive(),
      message: z.string(),
      acknowledgeReview: z.boolean().optional()
        .describe('Set only after reading the refusal and intending the weakening'),
    },
    (args) => attempt(() => promote(repo, policy, args)),
  );

  server.tool(
    'save_artifact',
    policy.canWrite
      ? 'Save a new revision. Refuses on any diagnostic error, and refuses a change '
        + 'that weakens a control or restates filed history unless `acknowledgeReview` '
        + 'is set — the acknowledgement is recorded against the revision. Pass '
        + '`expectedRevision` from a prior read to detect a concurrent edit.'
      : 'Disabled: this registry connection is read-only. Set KEEL_MCP_WRITE=1 to '
        + 'allow saves. Use assess_change and validate to author and test without writing.',
    {
      name: z.string(),
      body: z.string(),
      message: z.string().describe('Why this change is being made — it lands in the history'),
      kind: z.string().optional(),
      expectedRevision: z.number().int().optional(),
      acknowledgeReview: z.boolean().optional()
        .describe('Set only after reading assess_change and intending the weakening'),
    },
    (args) => attempt(() => saveArtifact(repo, policy, args)),
  );
}

export async function main(): Promise<void> {
  const policy = policyFromEnv(process.env);
  const db = await connect();
  await migrate(db);
  const repo = new Repository(db);
  await repo.seed(shippedDocuments());

  const server = new McpServer({ name: NAME, version: VERSION });
  register(server, repo, policy);

  // stdout is the protocol channel, so every human-readable word goes to stderr.
  // A stray console.log here corrupts the stream and the failure looks like a
  // client bug.
  process.stderr.write(
    `${NAME} ${VERSION} on ${db.dialect.name} — `
    + `${policy.canWrite ? 'writes ALLOWED' : 'read-only'}, `
    + `identity ${policy.identity}, fixture ${policy.fixture}\n`,
  );

  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run directly, not imported. Compared as a resolved URL rather than matched
// against the path: the sibling guard in `keel-registry` was a regex on the
// file's own location and silently stopped matching when the file moved. This
// one still matched only because `registry-mcp/server.ts` happens to contain
// `mcp/server.ts`. Luck is not a guard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
