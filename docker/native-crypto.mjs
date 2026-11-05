import crypto from 'node:crypto';

// Hono 2 no longer installs this global as an import side effect. Keep the
// gateway's tested fallback explicit without replacing Node's existing crypto.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: crypto,
    configurable: true,
    writable: true,
  });
}
