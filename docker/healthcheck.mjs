import { get } from 'node:http';

// A bounded HTTP liveness check. No shell, MCP session or server is launched
// by the default HEALTH_CHECK=gateway endpoint. Explicit server mode still
// has the gateway's ten-second MCP probe budget.
const request = get({
  hostname: '127.0.0.1',
  port: process.env.PORT || 8000,
  path: '/healthz',
  agent: false,
}, response => {
  response.resume();
  response.once('end', () => process.exit(response.statusCode === 200 ? 0 : 1));
  response.once('error', () => process.exit(1));
});
const deadline = setTimeout(() => {
  request.destroy();
  process.exit(1);
}, 12000);
deadline.unref();
request.once('error', () => process.exit(1));
