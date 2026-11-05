import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [root, tree] = process.argv.slice(2);
if (!root || !['src', 'dist'].includes(tree)) throw new Error('Usage: patch-supergateway.mjs ROOT src|dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'supergateway' || pkg.version !== '4.2.1') throw new Error('Patch requires exact Supergateway 4.2.1');
const dir = join(root, tree, 'lib');
const file = join(dir, `modernSdk.${tree === 'src' ? 'ts' : 'js'}`);
const source = await readFile(file, 'utf8');
if (!source.startsWith('export {') || !source.includes('@modelcontextprotocol/node')) {
  throw new Error('Unexpected modernSdk layout; review patch before building');
}
await copyFile(fileURLToPath(new URL('./native-crypto.mjs', import.meta.url)), join(dir, `native-crypto.${tree === 'src' ? 'ts' : 'js'}`));
await writeFile(file, "import './native-crypto.js';\n" + source);

if (tree === 'src') {
  // The UTF-8 test still controls createServer. Preserve the rest of the real
  // Node HTTP exports now read by Hono 2; no decoder assertion is changed.
  const fixture = join(root, 'tests', 'stdoutUtf8Decoding.test.ts');
  const text = await readFile(fixture, 'utf8');
  const before = "namedExports: { createServer: () => ({ listen() {}, on() {} }) },";
  if (text.split(before).length !== 2) throw new Error('Unexpected HTTP mock fixture; review patch');
  await writeFile(fixture, "import http from 'node:http'\n" + text.replace(before, "namedExports: { ...http, createServer: () => ({ listen() {}, on() {} }) },"));
}
console.log(`Applied explicit crypto fallback to Supergateway 4.2.1 ${tree}`);
