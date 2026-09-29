/**
 * `npm run mcp` — the treasury grid's MCP server over stdio, on the seeded
 * book. GRID_ROWS sets the book's size (default 50,000); GRID_SEED its seed.
 * The entry lives at the package root because `src` may not import `node:`
 * (the boundaries test), and a stdio server is the one place that must.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { inMemorySource } from './src/data/inMemorySource';
import { generatePositions } from './src/data/mock';
import { buildGridServer } from './src/agent/server';

const rows = generatePositions(Number(process.env.GRID_ROWS ?? 50_000), process.env.GRID_SEED ? Number(process.env.GRID_SEED) : undefined);
const server = buildGridServer(inMemorySource(rows, 'seeded book'));
await server.connect(new StdioServerTransport());
