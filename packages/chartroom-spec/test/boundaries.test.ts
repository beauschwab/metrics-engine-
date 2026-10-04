/**
 * The dependency direction, enforced:
 *
 *   spec ← widgets ← studio
 *   spec ← widgets ← charts ← studio   (Evil Charts landed as source, ADR-92)
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
  grid: join(ROOT, 'packages', 'chartroom-grid'),
  charts: join(ROOT, 'packages', 'chartroom-charts'),
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

  it('grid imports spec and the widgets’ React-free subpaths, never components, server or studio', () => {
    // `spec ← grid ← studio`. The grid reads `chartroom-widgets/format` so a
    // number in a cell is the number in a tile (ADR-64), and
    // `chartroom-widgets/spark` so a trend in a row is the trend on a card
    // (ADR-89); it never reaches the widget *components* — two catalogs of
    // renderers importing each other is how one ends up rendering the
    // other's empty state.
    expect(offenders(join(PKG.grid, 'src'), (s) =>
      s.includes('chartroom-api') || s.includes('chartroom-studio')
      || s.includes('chartroom-mcp') || s.startsWith('node:')
      || (s.includes('chartroom-widgets')
        && !s.endsWith('/contracts') && !s.endsWith('/format') && !s.endsWith('/spark')))).toEqual([]);
  });

  it('the widgets’ subpaths the grid and server may read stay React-free', () => {
    // The grid and the server import these without React in the room: a
    // component sneaking into one would drag a renderer across the boundary.
    for (const f of ['contracts.ts', 'format.ts', 'spark.ts']) {
      const imports = importsOf(join(PKG.widgets, 'src', f));
      expect(imports.filter((s) => s === 'react' || s.endsWith('.tsx') || /^\.\/[A-Z]/.test(s)), f).toEqual([]);
    }
  });

  it('charts import spec and widgets, never the grid, server, studio or Node', () => {
    // `spec ← widgets ← charts ← studio` (ADR-92). The Evil Charts widgets
    // sign the widgets' contract and format through the widgets' formatter;
    // the grid hands the studio a selection, and the studio hands it here —
    // the two renderer packages never import each other.
    expect(offenders(join(PKG.charts, 'src'), (s) =>
      s.includes('chartroom-grid') || s.includes('chartroom-api') || s.includes('chartroom-studio')
      || s.includes('chartroom-mcp') || s.startsWith('node:'))).toEqual([]);
  });

  it('the charts’ planner and option list stay React-free, and nothing in the package fetches', () => {
    // `./plan` and `./options` are what an agent or a server can read to
    // offer the same gallery without a renderer in the room.
    for (const f of ['plan.ts', 'options.ts', 'shape.ts']) {
      const imports = importsOf(join(PKG.charts, 'src', f));
      expect(imports.filter((s) => s === 'react' || s.endsWith('.tsx') || /^\.\/[A-Z]/.test(s) || /evilcharts\//.test(s)), f).toEqual([]);
    }
    const hits = sources(join(PKG.charts, 'src')).filter((f) =>
      /\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the grid’s table and components never fetch — only its data seam may', () => {
    // `src/data` is the boundary a DuckDB or Dremio source lands behind
    // (ADR-64); the hook, the columns and every component are as
    // presentation-only as a widget.
    const ui = ['grid', 'components', 'export', 'agent']
      .map((d) => join(PKG.grid, 'src', d))
      .filter((d) => statSync(d, { throwIfNoEntry: false })?.isDirectory());
    const hits = ui.flatMap(sources).filter((f) =>
      /\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
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
    for (const dir of [PKG.spec, PKG.widgets, PKG.charts, PKG.server]) {
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
