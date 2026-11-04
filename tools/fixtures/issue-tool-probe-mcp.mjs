// Synthetic, read-only MCP server for the isolated App Server tool-boundary probe.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  if (message.method === 'initialize') return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion || '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'synthetic-issue-probe', version: '1.0.0' } } });
  if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'synthetic_fixture_tool', description: 'Harmless synthetic test tool', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] } });
  if (message.method === 'tools/call') { if (process.argv[2]) appendFileSync(process.argv[2], 'call\n'); return send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'synthetic tool response' }] } }); }
  return send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported synthetic fixture method' } });
});
