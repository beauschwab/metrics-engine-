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
import type { Position } from '../data/mock';
import { defaultView, type ViewState } from '../grid/viewState';
import { describeView, queryView, setView } from './tools';

export const GRID_MCP_NAME = 'chartroom-grid';
export const GRID_MCP_VERSION = '0.1.0';

export const GRID_MCP_INSTRUCTIONS = `
The treasury grid over MCP. One view is the contract between you and the
screen: a versioned JSON of grouping, filters, sorting, expansion, visibility,
order, pinning and sizing. Read describe_view first — it lists the columns you
may name, which are groupable, how each filters, and what every slice means.
Then set_view with a patch (only the slices you change) and query_view for the
rows as the screen would show them, a window at a time. An invalid patch is
refused with issues naming what was wrong; nothing is guessed. Numbers in pct
columns are already percent units; mm columns are raw dollars shown in millions;
a weighted average is weighted by the column the contract names, never a mean
of means.
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

export function buildGridServer(source: DataSource<Position>, options: GridServerOptions = {}): McpServer {
  let view: ViewState = options.initialView ?? defaultView();
  const server = new McpServer({ name: GRID_MCP_NAME, version: GRID_MCP_VERSION }, { instructions: GRID_MCP_INSTRUCTIONS });

  server.registerTool('describe_view', {
    title: 'Describe the grid',
    description: 'The source (name, as-of, row count, columns with their meta), the current view, and the contract a view must satisfy. Read this before set_view.',
    inputSchema: {},
  }, async () => ok(await describeView(source, view)));

  server.registerTool('set_view', {
    title: 'Change the view',
    description: 'Merge a patch of view slices into the session view and validate it. Returns the merged view, or the issues that refused the patch. replace: true makes the patch the whole view.',
    inputSchema: {
      patch: z.record(z.string(), z.unknown()).describe('The slices to change, in the contract’s shapes.'),
      replace: z.boolean().optional().describe('Start from an empty view instead of the current one.'),
    },
  }, async ({ patch, replace }) => {
    const result = setView(view, patch, { replace });
    if (!result.ok) return refuse(result.issues);
    view = result.view;
    return ok({ ok: true, view });
  });

  server.registerTool('query_view', {
    title: 'Query the view',
    description: 'The rows the current view shows, as the screen shows them — group rows with subtotals, leaf rows with values, the grand totals — a window at a time. Supply view to answer a different view without changing the session’s.',
    inputSchema: {
      limit: z.number().int().min(1).max(1000).optional().describe('Rows per answer; default 100.'),
      offset: z.number().int().min(0).optional(),
      display: z.boolean().optional().describe('Include formatted strings; default true.'),
      expandAll: z.boolean().optional().describe('Expand every group for this answer only.'),
      view: z.record(z.string(), z.unknown()).optional().describe('A whole view to answer instead of the session’s.'),
    },
  }, async ({ limit, offset, display, expandAll, view: override }) => {
    let target = view;
    if (override !== undefined) {
      const parsed = setView(view, override, { replace: true });
      if (!parsed.ok) return refuse(parsed.issues);
      target = parsed.view;
    }
    return ok(await queryView(source, target, { limit, offset, display, expandAll }));
  });

  return server;
}
