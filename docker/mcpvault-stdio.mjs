import { spawn } from 'node:child_process';

const readOnly = (process.env.MCP_READ_ONLY ?? 'false').toLowerCase();
if (!['true', 'false', '1', '0'].includes(readOnly)) {
  console.error('MCP_READ_ONLY must be true, false, 1, or 0');
  process.exit(1);
}

const args = [
  '/app/node_modules/@bitbonsai/mcpvault/dist/server.js',
  process.env.VAULT_PATH || '/vault',
];
if (readOnly === 'true' || readOnly === '1') args.push('--read-only');

// Pass paths as arguments; no vault path is interpolated into a shell command.
const server = spawn(process.execPath, args, { stdio: 'inherit' });
server.once('error', error => {
  console.error(`Unable to start MCPVault: ${error.message}`);
  process.exit(1);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.kill(signal));
}
server.once('exit', (code, signal) => {
  process.exit(code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1));
});
