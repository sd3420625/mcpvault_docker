import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, link, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

assert.equal(process.env.MCP_TEST_VAULT_IS_DISPOSABLE, 'yes', 'Run only against an explicitly disposable test vault');
const vault = process.env.VAULT_PATH || '/vault';
const endpoint = new URL(process.env.MCP_PATH || '/mcp', `http://127.0.0.1:${process.env.PORT || 8000}`);
const key = process.env.SUPERGATEWAY_API_KEY;
const clients = [];
const transports = new WeakMap();
let count = 0;
const readOnly = ['true', '1'].includes(process.env.MCP_READ_ONLY || 'false');
await mkdir(vault, { recursive: true });
await writeFile(join(vault, '中文 笔记.md'), '---\ndate: 2026-10-28\ntime: "09:30"\n---\n# 检查\n这是兼容性验证。\n');
await writeFile(join(vault, '.hidden.md'), 'private');
await mkdir(join(vault, 'nested/.obsidian'), { recursive: true });
await writeFile(join(vault, 'nested/.obsidian/config.md'), 'private');
await writeFile('/tmp/mcpvault-outside.md', 'outside must stay private');
await symlink('/tmp/mcpvault-outside.md', join(vault, 'outside.md'));
await link(join(vault, '中文 笔记.md'), join(vault, 'hardlinked.md'));

async function connect() {
  const client = new Client({ name: 'mcpvault-gateway-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: key ? { Authorization: `Bearer ${key}` } : {} },
  });
  clients.push(client);
  transports.set(client, transport);
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, '0.17.1');
  return client;
}
function payload(result) {
  const text = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  try { return JSON.parse(text); } catch { return text; }
}
async function tool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`);
  const value = payload(result);
  assert.notEqual(value?.success, false, `${name}: ${JSON.stringify(value)}`);
  return value;
}
async function denied(client, name, args) {
  let rejected = false;
  try {
    const result = await client.callTool({ name, arguments: args });
    rejected = !!result.isError || payload(result)?.success === false;
  } catch {
    rejected = true;
  }
  assert.ok(rejected, `Expected ${name} to reject access: ${JSON.stringify(args)}`);
}
async function check(label, fn) {
  await fn();
  count++;
  console.log(`PASS ${label}`);
}
try {
  await check('gateway and MCP server health', async () => {
    const response = await fetch(new URL('/healthz', endpoint));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
  });
  if (key) await check('missing or wrong inbound API key is refused', async () => {
    for (const headers of [{}, { Authorization: 'Bearer incorrect-test-key' }]) {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      assert.equal(response.status, 401);
    }
  });
  const first = await connect();
  await check('existing MCP protocol and exact core version', () => first.ping());
  const names = new Set((await first.listTools()).tools.map(item => item.name));
  await check('tool discovery and new read tools', async () => {
    for (const name of ['read_note', 'search_notes', 'read_note_lines', 'get_note_outline', 'wiki_link']) assert.ok(names.has(name), name);
  });
  await check('Chinese names, spaces and immediate reads', async () => {
    assert.match(JSON.stringify(await tool(first, 'read_note', { path: '中文 笔记.md' })), /兼容性验证/);
  });
  await check('hardlinked notes remain readable', async () => {
    assert.match(JSON.stringify(await tool(first, 'read_note', { path: 'hardlinked.md' })), /兼容性验证/);
  });
  await check('search finds seeded note', async () => {
    assert.match(JSON.stringify(await tool(first, 'search_notes', { query: '兼容性验证', searchContent: true })), /中文 笔记/);
  });
  await check('hidden paths and outside symlinks are denied', async () => {
    for (const path of ['.hidden.md', 'nested/.obsidian/config.md', '../outside.md', 'outside.md']) await denied(first, 'read_note', { path });
  });
  if (readOnly) {
    await check('read-only mode hides and rejects every mutation', async () => {
      for (const name of ['write_note', 'patch_note', 'delete_note', 'move_note', 'move_file', 'update_frontmatter', 'manage_tags']) assert.ok(!names.has(name), name);
      await denied(first, 'write_note', { path: 'blocked.md', content: 'must not be written' });
      await assert.rejects(readFile(join(vault, 'blocked.md')));
    });
  } else {
    await check('create then immediately read a note', async () => {
      await tool(first, 'write_note', { path: '测试/新笔记.md', content: 'alpha\nbeta\n' });
      assert.match(JSON.stringify(await tool(first, 'read_note', { path: '测试/新笔记.md' })), /alpha/);
    });
    await check('append and prepend preserve existing content', async () => {
      await tool(first, 'write_note', { path: '测试/新笔记.md', content: 'end\n', mode: 'append' });
      await tool(first, 'write_note', { path: '测试/新笔记.md', content: 'start\n', mode: 'prepend' });
      assert.match(await readFile(join(vault, '测试/新笔记.md'), 'utf8'), /^start\nalpha\nbeta\nend\n$/);
    });
    await check('patch inserts dollar replacement patterns literally', async () => {
      await tool(first, 'patch_note', { path: '测试/新笔记.md', oldString: 'alpha', newString: '$& $$' });
      assert.match(await readFile(join(vault, '测试/新笔记.md'), 'utf8'), /\$& \$\$/);
    });
    await check('frontmatter update preserves date and quoting', async () => {
      await tool(first, 'update_frontmatter', { path: '中文 笔记.md', frontmatter: { verified: true }, merge: true });
      const text = await readFile(join(vault, '中文 笔记.md'), 'utf8');
      assert.match(text, /date: 2026-10-28\n/);
      assert.match(text, /time: "09:30"\n/);
    });
    await check('move and local trash preserve content', async () => {
      await tool(first, 'move_note', { oldPath: '测试/新笔记.md', newPath: '测试/已移动.md' });
      const before = await readFile(join(vault, '测试/已移动.md'), 'utf8');
      await denied(first, 'delete_note', { path: '测试/已移动.md', confirmPath: 'wrong.md', trashMode: 'local' });
      assert.equal(await readFile(join(vault, '测试/已移动.md'), 'utf8'), before);
      await tool(first, 'delete_note', { path: '测试/已移动.md', confirmPath: '测试/已移动.md', trashMode: 'local' });
      assert.equal(await readFile(join(vault, '.trash/测试/已移动.md'), 'utf8'), before);
    });
    await check('dangling symlinks cannot write outside the vault', async () => {
      await symlink('/tmp/mcpvault-missing-target.md', join(vault, 'dangling.md'));
      await denied(first, 'write_note', { path: 'dangling.md', content: 'must not escape' });
      await assert.rejects(readFile('/tmp/mcpvault-missing-target.md'));
      assert.equal(await readFile('/tmp/mcpvault-outside.md', 'utf8'), 'outside must stay private');
    });
  }
  await check('independent clients receive their own responses', async () => {
    const second = await connect();
    const results = await Promise.all([tool(first, 'read_note', { path: '中文 笔记.md' }), tool(second, 'read_note', { path: 'hardlinked.md' })]);
    for (const result of results) assert.match(JSON.stringify(result), /兼容性验证/);
    await second.close();
  });
  await check('a fresh session reconnects without losing files', async () => {
    await first.close();
    const replacement = await connect();
    assert.match(JSON.stringify(await tool(replacement, 'read_note', { path: '中文 笔记.md' })), /兼容性验证/);
  });
  await check('idle sessions expire and a new client recovers', async () => {
    const idle = await connect();
    const session = transports.get(idle).sessionId;
    assert.ok(session, 'Legacy stateful sessions must have an ID');
    const timeout = Number(process.env.SESSION_TIMEOUT);
    assert.ok(timeout > 0 && timeout <= 10000, 'Use a short timeout only in this disposable test container');
    await delay(timeout + 1500);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Session-Id': session, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'ping' }),
    });
    assert.equal(response.status, 404);
    const recovered = await connect();
    await recovered.ping();
  });
  console.log(`PASS ${count} HTTP checks; mode=${readOnly ? 'read-only' : 'read-write'}; MCPVault=0.17.1`);
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
}
