/**
 * Run a plan of MCP tool calls against a fresh grid server over stdio.
 * usage: tsx run-plan.ts plan.json [rows]   → prints [{call, isError, result}] as JSON
 */
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PKG = '/home/user/metrics-engine-/packages/chartroom-grid';
const plan: Array<{ tool: string; args?: Record<string, unknown> }> = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const transport = new StdioClientTransport({
  command: `${PKG}/../../node_modules/.bin/tsx`, args: ['mcp.ts'], cwd: PKG,
  env: { ...process.env, GRID_ROWS: process.argv[3] ?? '5000' } as Record<string, string>, stderr: 'inherit',
});
const client = new Client({ name: 'pressure', version: '0' });
await client.connect(transport);
const out = [];
for (const call of plan) {
  const t0 = performance.now();
  const r = await client.callTool({ name: call.tool, arguments: call.args ?? {} });
  const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
  let result: unknown = text;
  try { result = JSON.parse(text); } catch { /* raw */ }
  out.push({ call, isError: !!r.isError, ms: Math.round(performance.now() - t0), bytes: text.length, result });
}
await client.close();
console.log(JSON.stringify(out));
