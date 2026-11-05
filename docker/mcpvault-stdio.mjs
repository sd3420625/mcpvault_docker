const readOnly = (process.env.MCP_READ_ONLY ?? 'false').toLowerCase();
if (!['true', 'false', '1', '0'].includes(readOnly)) {
  console.error('MCP_READ_ONLY must be true, false, 1, or 0');
  process.exit(1);
}

// Run the official CLI in this process, rather than spawning a grandchild.
// A session's process group then contains only this MCPVault process: when
// Supergateway terminates the group, there is no intermediate Node wrapper
// dying at the same time as the child it was supposed to wait for.
process.argv = [
  process.execPath,
  '/app/node_modules/@bitbonsai/mcpvault/dist/server.js',
  process.env.VAULT_PATH || '/vault',
];
if (readOnly === 'true' || readOnly === '1') process.argv.push('--read-only');

// The vault path remains an argument, never shell-interpolated. Preserve the
// official 0.17.1 entry point and its CLI/read-only semantics.
await import('/app/node_modules/@bitbonsai/mcpvault/dist/server.js');
