/**
 * The query gateway.
 *
 * The browser never talks to Dremio. Credentials live here, every statement is
 * checked here, and the row cap and the timeout are applied here — so there is
 * one place to read to know what the registry is capable of doing to a warehouse.
 * The answer is: one capped, timed, read-only statement at a time.
 *
 * The transport is a short-lived Python process (`query/dremio.py`) because Arrow
 * Flight has no mature JavaScript client. That is a real cost — roughly half a
 * second of interpreter start per query — and it is why nothing on the editing
 * path calls this. Live reads are an explicit action, not something that happens
 * while you type.
 */

import { execFile } from 'node:child_process';
import { isReadOnly, withRowCap } from './readonly';

export interface DremioConfig {
  /** `grpc+tls://host:32010`, or `grpc://` for a local instance. */
  uri: string;
  /** A personal access token. Never logged, never returned to a client. */
  token: string;
  /** Hard ceiling on rows returned to the caller. */
  rowCap: number;
  timeoutSeconds: number;
  /** Skip TLS verification — a development instance with a self-signed cert. */
  insecure: boolean;
  /** Whether a row-level sample may leave the server at all. */
  sampling: 'off' | 'allowlist';
  /** Views a sample is permitted for, when sampling is allowlisted. */
  sampleAllowlist: string[];
}

export interface QueryColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Array<Record<string, unknown>>;
  /** True when the warehouse had more rows than the cap allowed through. */
  truncated: boolean;
  /** The statement as sent, cap and all — so a result can be reproduced. */
  sql: string;
  elapsedMs: number;
}

export class QueryRefused extends Error {}
export class QueryFailed extends Error {}
export class NotConfigured extends Error {}

export function dremioFromEnv(env: NodeJS.ProcessEnv = process.env): DremioConfig | null {
  if (!env.KEEL_DREMIO_URI) return null;
  return {
    uri: env.KEEL_DREMIO_URI,
    token: env.KEEL_DREMIO_TOKEN || '',
    rowCap: Number(env.KEEL_DREMIO_ROW_CAP || 5000),
    timeoutSeconds: Number(env.KEEL_DREMIO_TIMEOUT_SECONDS || 30),
    insecure: env.KEEL_DREMIO_INSECURE === 'true',
    // Off unless switched on deliberately. Row-level position data leaving the
    // server is a policy decision, so the default is the conservative one and
    // enabling it is a visible act rather than an omission.
    sampling: env.KEEL_DREMIO_SAMPLING === 'allowlist' ? 'allowlist' : 'off',
    sampleAllowlist: (env.KEEL_DREMIO_SAMPLE_VIEWS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** May a row-level sample of this view leave the server? */
export function samplingAllowed(config: DremioConfig, view: string): Verdict {
  if (config.sampling === 'off') {
    return {
      ok: false,
      reason:
        'row-level sampling is off. Set KEEL_DREMIO_SAMPLING=allowlist and name the ' +
        'view in KEEL_DREMIO_SAMPLE_VIEWS to allow it',
    };
  }
  if (!config.sampleAllowlist.includes(view)) {
    return {
      ok: false,
      reason: `${view} is not in KEEL_DREMIO_SAMPLE_VIEWS, so its rows may not leave the server`,
    };
  }
  return { ok: true };
}

interface Verdict {
  ok: boolean;
  reason?: string;
}

interface PythonFailure {
  error?: string;
  kind?: string;
}

/**
 * Run one statement.
 *
 * Refuses before it connects. A statement that is not a single read never reaches
 * the network, so a bug in the transport cannot turn into a write.
 */
export async function query(
  config: DremioConfig,
  sql: string,
  options: { rowCap?: number } = {},
): Promise<QueryResult> {
  const verdict = isReadOnly(sql);
  if (!verdict.ok) throw new QueryRefused(verdict.reason || 'refused');

  const cap = Math.max(1, Math.min(options.rowCap ?? config.rowCap, config.rowCap));
  const capped = withRowCap(sql, cap);
  const started = Date.now();

  const payload = JSON.stringify({
    uri: config.uri,
    sql: capped,
    token: config.token,
    timeoutSeconds: config.timeoutSeconds,
    insecure: config.insecure,
  });

  const raw = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      'python3',
      [new URL('query/dremio.py', import.meta.url).pathname],
      {
        // Room for the cap, not for whatever the warehouse felt like sending.
        maxBuffer: 128 * 1024 * 1024,
        timeout: (config.timeoutSeconds + 15) * 1000,
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(stdout);
          return;
        }
        // The warehouse's own message is worth far more than "the query failed",
        // so it is carried through rather than replaced.
        let detail = stderr.trim();
        try {
          const parsed = JSON.parse(stderr) as PythonFailure;
          detail = parsed.error || detail;
        } catch {
          // stderr was not the structured failure — use it as it came.
        }
        reject(new QueryFailed(detail || err.message));
      },
    );
    child.stdin?.end(payload);
  });

  const parsed = JSON.parse(raw) as { columns: QueryColumn[]; rows: Array<Record<string, unknown>> };
  const truncated = parsed.rows.length > cap;

  return {
    columns: parsed.columns,
    // The cap was fetched as `cap + 1` so truncation is detectable; the extra row
    // is dropped rather than shown, because a partial row is not a row.
    rows: truncated ? parsed.rows.slice(0, cap) : parsed.rows,
    truncated,
    sql: capped,
    elapsedMs: Date.now() - started,
  };
}

/**
 * A stratified sample.
 *
 * Uniform sampling is the wrong default here. The rarest buckets are the ones an
 * author most needs to see — an unmapped segment, a collateral class with three
 * positions — and a uniform sample of a million rows will miss them while looking
 * representative. Taking up to `perStratum` rows from each distinct combination of
 * the strata columns keeps the tail.
 *
 * The trade is stated rather than hidden: the sample is *not* proportional, so
 * counts drawn from it are not estimates of the population. It is for seeing
 * whether a rule classifies each kind of row correctly, not for measuring how
 * much money is in each bucket.
 */
export function stratifiedSample(
  source: string,
  strata: string[],
  perStratum: number,
  asOfColumn: string,
  asOf: string,
): string {
  const partition = strata.length ? strata.join(', ') : '1';
  return (
    `WITH keel_source AS (\n` +
    `  SELECT * FROM ${source}\n  WHERE ${asOfColumn} = DATE '${asOf}'\n),\n` +
    `keel_ranked AS (\n` +
    `  SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${asOfColumn}) AS keel_rn\n` +
    `  FROM keel_source\n)\n` +
    `SELECT * FROM keel_ranked WHERE keel_rn <= ${perStratum}`
  );
}
