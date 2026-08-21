/**
 * RFC 6902 JSON Patch — the subset lint fixes actually emit.
 *
 * `add`, `replace`, `remove`, applied immutably: the input document is never
 * mutated, because the studio holds the pre-fix spec for undo and the linter
 * may be looking at it concurrently. A fix that fails to apply throws — a
 * half-applied fix is worse than no fix, and the caller decides what to tell
 * the user.
 */

export type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string };

export class PatchFailed extends Error {}

function tokens(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new PatchFailed(`bad pointer: ${path}`);
  return path
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function cloneShallow(v: unknown): unknown {
  if (Array.isArray(v)) return v.slice();
  if (v !== null && typeof v === 'object') return { ...(v as Record<string, unknown>) };
  return v;
}

/** Apply one op, structurally sharing everything off the touched path. */
function applyOne(doc: unknown, op: PatchOp): unknown {
  const path = tokens(op.path);
  if (!path.length) {
    if (op.op === 'remove') throw new PatchFailed('cannot remove the document root');
    return op.value;
  }

  const root = cloneShallow(doc);
  let parent: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const container = parent as Record<string, unknown> & unknown[];
    const idx = Array.isArray(container) ? Number(key) : key;
    const next = (container as Record<string | number, unknown>)[idx as string | number];
    if (next === undefined || next === null || typeof next !== 'object') {
      throw new PatchFailed(`no such path: ${op.path}`);
    }
    const copy = cloneShallow(next);
    (container as Record<string | number, unknown>)[idx as string | number] = copy;
    parent = copy;
  }

  const last = path[path.length - 1];
  if (Array.isArray(parent)) {
    const arr = parent as unknown[];
    const idx = last === '-' ? arr.length : Number(last);
    if (!Number.isInteger(idx) || idx < 0 || idx > arr.length) {
      throw new PatchFailed(`bad array index in ${op.path}`);
    }
    if (op.op === 'add') arr.splice(idx, 0, op.value);
    else if (op.op === 'replace') {
      if (idx >= arr.length) throw new PatchFailed(`no such path: ${op.path}`);
      arr[idx] = op.value;
    } else {
      if (idx >= arr.length) throw new PatchFailed(`no such path: ${op.path}`);
      arr.splice(idx, 1);
    }
  } else {
    const obj = parent as Record<string, unknown>;
    if (op.op === 'add' || op.op === 'replace') {
      if (op.op === 'replace' && !(last in obj)) throw new PatchFailed(`no such path: ${op.path}`);
      obj[last] = op.value;
    } else {
      if (!(last in obj)) throw new PatchFailed(`no such path: ${op.path}`);
      delete obj[last];
    }
  }
  return root;
}

export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  let out: unknown = doc;
  for (const op of ops) out = applyOne(out, op);
  return out as T;
}
