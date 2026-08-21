/**
 * Canonical form and content identity.
 *
 * Two specs that mean the same thing must hash the same, whatever key order
 * their JSON arrived in — the hash is the reproducibility anchor (a version is
 * its bytes) and the query-cache key upstream. So: keys sorted recursively,
 * `undefined` dropped, no whitespace. Array order is preserved — widget order
 * and rule order are meaning, not formatting.
 */

import { sha256Hex } from './sha256';
import type { DashboardSpec } from './schema';

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const inner = (v as Record<string, unknown>)[k];
      if (inner !== undefined) out[k] = sortValue(inner);
    }
    return out;
  }
  return v;
}

export function canonicalize(spec: DashboardSpec): string {
  return JSON.stringify(sortValue(spec));
}

export function specHash(spec: DashboardSpec): string {
  return sha256Hex(canonicalize(spec));
}
