/**
 * The grid over MCP (ADR-69): three tools, one session view.
 *
 * `describe_view` hands an agent the source, the current view and the
 * contract; `set_view` patches the session's view and answers with the
 * merged view or the issues that refused the patch; `query_view` answers
 * the session's view — or a view the call supplies — a window of rows at a
 * time, exactly as the screen would. The server holds one view per process:
 * the agent's, which a person can be handed as a link (`views/url.ts`) or a
 * saved view. It holds no SQL and does no fetching; the source is asked
 * through the seam.
 *
 * Thin by contract, like `chartroom-mcp`: validate, call the tool, shape.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DataSource } from '../data/source';
import { schemaFromDescription, type GridRecord } from '../grid/schema';
import { defaultView, type ViewState } from '../grid/viewState';
import { checkAgainstData, describeView, queryView, setView } from './tools';

export const GRID_MCP_NAME = 'chartroom-grid';
export const GRID_MCP_VERSION = '0.1.0';

export const GRID_MCP_INSTRUCTIONS = `
The treasury grid over MCP. One view is the contract between you and the
screen: a versioned JSON of grouping, filters, sorting, expansion, visibility,
order, pinning, sizing, aggregations, formats, calculated columns and pivot.
Read describe_view first — it lists the columns you may name, which are
groupable, how each filters, every dimension's values where there are few
enough to list, and what every slice means. Then set_view with a patch (each
slice you name replaces that slice whole) and query_view for the rows as the
screen would show them, a window at a time. An invalid patch is refused with
issues naming what was wrong; nothing is guessed. A patch the data cannot back
— a filter value no row has, a group that does not exist — is accepted with
warnings saying so: read them before you answer. Numbers in pct columns are
already percent units; mm columns are raw dollars shown in millions; a weighted
average is weighted by the column the contract names, never a mean of means.
To start again: set_view with replace: true and an empty patch.
`.trim();

type Content = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
const ok = (value: unknown): Content => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const refuse = (issues: string[]): Content => ({
  content: [{ type: 'text', text: JSON.stringify({ ok: false, issues }, null, 2) }],
  isError: true,
});

export interface GridServerOptions {
  initialView?: ViewState;
}

export function buildGridServer(source: DataSource<GridRecord>, options: GridServerOptions = {}): McpServer {
  let view: ViewState = options.initialView ?? defaultView();
  // Distinct values per dimension, asked of the source once per process.
  const distinct = new Map<string, Promise<string[] | undefined>>();
  const server = new McpServer({ name: GRID_MCP_NAME, version: GRID_MCP_VERSION }, { instructions: GRID_MCP_INSTRUCTIONS });

  server.registerTool('describe_view', {
    title: 'Describe the grid',
    description: 'The source (name, as-of, row count, columns with their meta), the current view, and the contract a view must satisfy — each column’s filter shape, aggregations, formats, and a dimension’s values. Read this before set_view.',
    inputSchema: {},
  }, async () => ok(await describeView(source, view, distinct)));

  server.registerTool('set_view', {
    title: 'Change the view',
    description: 'Merge a patch of view slices into the session view and validate it: each slice the patch names replaces that slice whole. Returns the merged view (with warnings when it names values the data does not have), or the issues that refused the patch and left the view as it was. replace: true makes the patch the whole view; replace: true with an empty patch is the default view.',
    inputSchema: {
      patch: z.record(z.string(), z.unknown()).describe('The slices to change, in the contract’s shapes.'),
      replace: z.boolean().optional().describe('Start from an empty view instead of the current one.'),
    },
  }, async ({ patch, replace }) => {
    const schema = schemaFromDescription(await source.describe());
    const result = setView(view, patch, { replace }, schema);
    if (!result.ok) return refuse(result.issues);
    const data = await checkAgainstData(result.view, source, schema, distinct);
    if (data.issues.length) return refuse(data.issues);
    view = result.view;
    return ok({ ok: true, ...(data.warnings.length ? { warnings: data.warnings } : {}), view });
  });

  server.registerTool('query_view', {
    title: 'Query the view',
    description: 'The rows the current view shows, as the screen shows them — group rows (group.count is the group’s leaf rows) with subtotals, leaf rows with values, the grand totals, columns in screen order — a window at a time. total is the leaf rows the filters keep; modelRows the rows the window was cut from; truncated means more rows lie beyond this window. Supply view (a whole view, not a patch: what it omits takes defaults) to answer a different view without changing the session’s; it is checked as set_view checks.',
    inputSchema: {
      limit: z.number().int().min(1).max(1000).optional().describe('Rows per answer; default 100.'),
      offset: z.number().int().min(0).optional(),
      display: z.boolean().optional().describe('Include formatted strings; default true.'),
      expandAll: z.boolean().optional().describe('Expand every group, at every level down to the leaves, for this answer only.'),
      view: z.record(z.string(), z.unknown()).optional().describe('A whole view to answer instead of the session’s.'),
    },
  }, async ({ limit, offset, display, expandAll, view: override }) => {
    let target = view;
    const schema = schemaFromDescription(await source.describe());
    if (override !== undefined) {
      const parsed = setView(view, override, { replace: true }, schema);
      if (!parsed.ok) return refuse(parsed.issues);
      target = parsed.view;
    }
    const data = await checkAgainstData(target, source, schema, distinct);
    if (data.issues.length) return refuse(data.issues);
    const answer = await queryView(source, target, { limit, offset, display, expandAll });
    return ok(data.warnings.length ? { warnings: data.warnings, ...answer } : answer);
  });

  return server;
}
