/**
 * The dependency direction, enforced:
 *
 *   spec ← widgets ← studio
 *   spec ← server          (server may also read widgets' *contracts* — data,
 *                           never components)
 *   NOTHING imports studio. spec imports NOTHING internal, and no Node, DOM
 *   or React API — it runs in the browser, the server and the MCP process.
 *
 * A lint plugin could do this; a forty-line test does it with zero new
 * dependencies and fails with the offending file and line.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  // `from '…'` and bare `import '…'` only — an export of the string literal
  // 'BLOCK' is not an import, however much it looks like one to a loose regex.
  return [...text.matchAll(/(?:^|\n)\s*(?:import|export)(?:[^'"\n]*\sfrom\s*|\s*)['"]([^'"]+)['"]/g)]
    .map((m) => m[1]);
}

const offenders = (dir: string, bad: (spec: string) => boolean): string[] =>
  sources(dir).flatMap((f) =>
    importsOf(f).filter(bad).map((s) => `${f.replace(ROOT, 'chartroom')} imports ${s}`));

describe('package boundaries', () => {
  it('spec is pure — no packages, no Node, no React, no engine', () => {
    expect(offenders(join(ROOT, 'spec', 'src'), (s) =>
      s.startsWith('node:') || s === 'react' || s.includes('chartroom-')
      || s.includes('../../') || (!s.startsWith('.') && s !== 'zod'))).toEqual([]);
  });

  it('widgets import spec but never server, studio, or the network', () => {
    expect(offenders(join(ROOT, 'widgets', 'src'), (s) =>
      s.includes('chartroom-server') || s.includes('chartroom-studio')
      || s.startsWith('node:'))).toEqual([]);
  });

  it('server imports spec and widget contracts, never components or studio', () => {
    expect(offenders(join(ROOT, 'server', 'src'), (s) =>
      s.includes('chartroom-studio')
      || (s.includes('chartroom-widgets') && !s.endsWith('/contracts')))).toEqual([]);
  });

  it('nothing imports studio', () => {
    for (const pkg of ['spec', 'widgets', 'server']) {
      expect(offenders(join(ROOT, pkg), (s) => s.includes('chartroom-studio'))).toEqual([]);
    }
  });

  it('widgets never fetch — presentation only', () => {
    const hits = sources(join(ROOT, 'widgets', 'src')).filter((f) =>
      /\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
