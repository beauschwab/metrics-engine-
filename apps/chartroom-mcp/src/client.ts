/**
 * The Chartroom server, as a client — the only thing this package talks to.
 *
 * Identity is the crux: every request this process makes carries
 * `agent:mcp-<session>` as its identity, plus the human principal from
 * `CHARTROOM_MCP_USER` for attribution. The server treats `agent:*` as an
 * agent session — no approvals, no composition before an approved brief — and
 * nothing an agent sends can change that, because the entitlement lives on
 * the other side of this HTTP boundary, not in this process.
 */

import { randomUUID } from 'node:crypto';

const API = process.env.CHARTROOM_API || 'http://127.0.0.1:8788';

/**
 * One identity per MCP process — the SR 11-7 evidence trail's actor. The
 * label names the surface that fronts this process (`mcp` for Claude Code,
 * `lg` for the LangGraph agent service) so the audit trail says which; it is
 * cosmetic to entitlements — anything matching `agent:*` is an agent to the
 * server, whatever it calls itself.
 */
const LABEL = /^[a-z][a-z0-9-]*$/.test(process.env.CHARTROOM_MCP_LABEL || '')
  ? process.env.CHARTROOM_MCP_LABEL
  : 'mcp';
export const SESSION_ID = `agent:${LABEL}-${randomUUID().slice(0, 8)}`;
export const PRINCIPAL = process.env.CHARTROOM_MCP_USER || '';

export class ServerError extends Error {
  constructor(public status: number, message: string, public problems: string[] = []) {
    super(message);
  }
}

export async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-identity': SESSION_ID,
      ...(PRINCIPAL ? { 'x-principal': PRINCIPAL } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json()) as T & { error?: string; problems?: string[] };
  if (!res.ok) {
    throw new ServerError(res.status, data.error || `server said ${res.status}`, data.problems ?? []);
  }
  return data;
}
