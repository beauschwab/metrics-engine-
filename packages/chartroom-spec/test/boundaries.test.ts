/**
 * The dependency direction, enforced:
 *
 *   spec ← widgets ← studio
 *   spec ← server          (server may also read widgets' *contracts* — data,
 *                           never components)
 *   NOTHING imports studio. spec imports NOTHING internal, and no Node, DOM
 *   or React API — it runs in the browser, the server and the MCP process.
 *
 * And outward: nothing under chartroom/ may climb out of its own workspace with
 * a relative path. The registry engine and its db/dialect layer are `keel-engine`
 * and `keel-registry`, declared dependencies with an exports map (ADR-49). Before
 * that they were twenty-odd `../../../src/engine/...` imports — a real edge npm
 * could not install, tooling could not see, and this file did not check.
 *
 * A lint plugin could do this; a forty-line test does it with zero new
 * dependencies and fails with the offending file and line.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The workspace root: these packages live under `packages/` and `apps/` now,
// so a boundary rule has to name both. `PKG` maps the role each rule talks
// about to where it actually sits.
const ROOT = join(__dirname, '..', '..', '..');
const PKG = {
  spec: join(ROOT, 'packages', 'chartroom-spec'),
  widgets: join(ROOT, 'packages', 'chartroom-widgets'),
  patterns: join(ROOT, 'packages', 'chartroom-patterns'),
  critics: join(ROOT, 'packages', 'chartroom-critics'),
  server: join(ROOT, 'apps', 'chartroom-api'),
  mcp: join(ROOT, 'apps', 'chartroom-mcp'),
  studio: join(ROOT, 'apps', 'chartroom-studio'),
} as const;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const SKIP = new Set(['node_modules', 'dist', 'test-results', 'playwright-report']);

function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sheets(p));
    else if (name.endsWith('.css')) out.push(p);
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

/**
 * Relative specifiers that resolve outside the package they were written in.
 * `pkg` is the package root; a specifier escapes when the path it resolves to
 * is not under it.
 */
const escapees = (
  pkg: string,
  specsOf: (file: string) => string[],
  collect: (dir: string) => string[] = sources,
): string[] =>
  collect(pkg).flatMap((f) =>
    specsOf(f)
      .filter((spec) => spec.startsWith('.'))
      .filter((spec) => relative(pkg, resolve(dirname(f), spec)).startsWith('..'))
      .map((spec) => `${f.replace(`${ROOT}/`, '')} imports ${spec}`));

const offenders = (dir: string, bad: (spec: string) => boolean): string[] =>
  sources(dir).flatMap((f) =>
    importsOf(f).filter(bad).map((s) => `${f.replace(`${ROOT}/`, '')} imports ${s}`));

describe('package boundaries', () => {
  it('spec is pure — no packages, no Node, no React, no engine', () => {
    expect(offenders(join(PKG.spec, 'src'), (s) =>
      s.startsWith('node:') || s === 'react' || s.includes('chartroom-')
      || s.includes('../../') || (!s.startsWith('.') && s !== 'zod'))).toEqual([]);
  });

  it('widgets import spec but never server, studio, or the network', () => {
    expect(offenders(join(PKG.widgets, 'src'), (s) =>
      s.includes('chartroom-api') || s.includes('chartroom-studio')
      || s.startsWith('node:'))).toEqual([]);
  });

  it('server imports spec and widget contracts/format, never components or studio', () => {
    // `/contracts` and `/format` are the React-free subpaths: catalog data and
    // number formatting. The deck export uses `/format` so the committee pack
    // formats numbers exactly as the widgets do (ADR-29). Components stay out.
    expect(offenders(join(PKG.server, 'src'), (s) =>
      s.includes('chartroom-studio')
      || (s.includes('chartroom-widgets')
        && !s.endsWith('/contracts') && !s.endsWith('/format')))).toEqual([]);
  });

  it('nothing imports studio', () => {
    for (const dir of [PKG.spec, PKG.widgets, PKG.server]) {
      expect(offenders(dir, (s) => s.includes('chartroom-studio'))).toEqual([]);
    }
  });

  it('nothing climbs out of its workspace with a relative path', () => {
    // Resolved, not pattern-matched: how many `../` segments escape a package
    // depends on how deep the importing file sits, so a fixed prefix is wrong
    // for some file in every layout. Depend on the neighbour by name instead,
    // so the manifest records the edge and npm can install it.
    for (const dir of Object.values(PKG)) {
      expect(escapees(dir, (f) => importsOf(f))).toEqual([]);
    }
  });

  it('stylesheets name the design system too, rather than climbing to it', () => {
    // The scan above reads `import`/`export`, so it cannot see `@import` in a
    // stylesheet. `studio/src/styles.css` reached Aperture's tokens at
    // `../../../src/styles/aperture/...` — precisely the copy-that-claims-
    // provenance its own header warns about. They are `keel-design-system`.
    const cssImports = (f: string): string[] =>
      [...readFileSync(f, 'utf8').matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(Object.values(PKG).flatMap((d) => escapees(d, cssImports, sheets))).toEqual([]);
  });

  it('widgets never fetch — presentation only', () => {
    const hits = sources(join(PKG.widgets, 'src')).filter((f) =>
      /\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
