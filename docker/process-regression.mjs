import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

assert.equal(process.env.MCP_TEST_VAULT_IS_DISPOSABLE, 'yes');
const endpoint = new URL('http://127.0.0.1:8000/mcp');
const clients = new Set();
const transports = new WeakMap();

async function health() {
  await new Promise((resolve, reject) => {
    const req = get(new URL('/healthz', endpoint), res => {
      res.resume();
      res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error(`health ${res.statusCode}`)));
    });
    const timer = setTimeout(() => req.destroy(new Error('health deadline')), 12000);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
  });
}

async function snapshot() {
  const rows = await Promise.all((await readdir('/proc')).filter(n => /^\d+$/.test(n)).map(async pid => {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const cmd = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ');
      return { pid: Number(pid), state: fields[0], cmd };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
      throw error;
    }
  }));
  const visible = rows.filter(Boolean);
  return { processes: visible.length, zombies: visible.filter(p => p.state === 'Z'), servers: visible.filter(p => /^(?:\S*\/)?node \/app\/docker\/mcpvault-stdio\.mjs(?: |$)/.test(p.cmd)) };
}

async function clean(label) {
  const deadline = Date.now() + 12000;
  let state;
  do {
    state = await snapshot();
    if (!state.zombies.length && !state.servers.length) {
      assert.ok(state.processes <= 8, `Unexpected idle processes: ${JSON.stringify(state)}`);
      console.log(`PASS ${label}: ${JSON.stringify(state)}`);
      return state;
    }
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(`${label}: processes failed to return to baseline: ${JSON.stringify(state)}`);
}

async function connect() {
  const client = new Client({ name: 'process-regression', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint);
  clients.add(client);
  transports.set(client, transport);
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, '0.17.1');
  await client.ping();
  assert.ok((await client.listTools()).tools.some(t => t.name === 'read_note'));
  return client;
}

async function close(client, terminate = true) {
  if (terminate) await transports.get(client).terminateSession();
  await client.close();
  clients.delete(client);
}

try {
  assert.match(await readFile('/proc/1/comm', 'utf8'), /^tini\n$/);
  await health();
  if (process.argv.includes('--hold')) {
    await connect();
    await writeFile('/vault/.lifecycle-ready', 'ready', { flag: 'wx', mode: 0o600 });
    await new Promise(() => {});
  }
  await clean('startup');
  for (let round = 0; round < 3; round++) {
    // Fast polls must not create one server per poll; spaced polls below also
    // cross the optional server-health cache boundary.
    for (let i = 0; i < 40; i++) await health();
    await clean(`health round ${round}`);
    if (process.env.HEALTH_CHECK === 'server' && round < 2) await delay(10100);
  }
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 8; i++) await close(await connect());
    await clean(`explicit DELETE round ${round}`);
  }
  const concurrent = await Promise.all(Array.from({ length: 4 }, connect));
  await Promise.all(concurrent.map(client => close(client)));
  await clean('concurrent clients');

  const idle = await connect();
  await close(idle, false);
  await delay(Number(process.env.SESSION_TIMEOUT) + 1000);
  await clean('disconnected session timeout');

  const doomed = await connect();
  const servers = (await snapshot()).servers;
  assert.equal(servers.length, 1, 'Exactly one MCPVault process per session');
  process.kill(servers[0].pid, 'SIGKILL');
  await doomed.close();
  clients.delete(doomed);
  await clean('abrupt MCPVault exit');
  await close(await connect());
  await clean('reconnect after child failure');

  // Manufacture a genuine orphan independently of the application launcher.
  // The shell is reaped by Node; its sleep child must be adopted by PID 1.
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', 'sleep 0.1 >/dev/null 2>&1 & exit 0'], { stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`orphan fixture ${code}`)));
    });
  }
  await delay(500);
  await clean('adopted orphan reaping');
  console.log(`PASS process lifecycle; health=${process.env.HEALTH_CHECK}; 120 health polls; 24 sequential sessions; 4 concurrent sessions`);
} finally {
  await Promise.allSettled([...clients].map(client => close(client)));
}
