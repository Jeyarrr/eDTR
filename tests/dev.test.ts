import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

async function fixture(body: string) {
  const server = createServer((_req, res) => res.end(body));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { server, port: address.port };
}
async function run(apiPort: number, clientPort: number) {
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    env: { ...process.env, PORT: String(apiPort), VITE_PORT: String(clientPort) },
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const code = await new Promise((resolve) => child.once('exit', resolve));
  return { code, output };
}
test('second dev launch recognizes an existing eDTR without starting more processes', async () => {
  const api = await fixture(JSON.stringify({ status: 'ok', database: 'PostgreSQL' }));
  const client = await fixture('<title>eDTR</title>');
  try {
    const result = await run(api.port, client.port);
    assert.equal(result.code, 0);
    assert.match(result.output, /eDTR is already running/);
    assert.doesNotMatch(result.output, /schema is ready|Local PostgreSQL ready/);
  } finally {
    api.server.close();
    client.server.close();
  }
});
test('unrelated occupied ports fail before database setup and leave existing services alive', async () => {
  const api = await fixture('another service');
  const client = await fixture('another website');
  try {
    const result = await run(api.port, client.port);
    assert.equal(result.code, 1);
    assert.match(result.output, /already in use/);
    assert.doesNotMatch(result.output, /schema is ready|Local PostgreSQL ready/);
    assert.equal(await (await fetch(`http://127.0.0.1:${client.port}`)).text(), 'another website');
  } finally {
    api.server.close();
    client.server.close();
  }
});
test('invalid ports produce an actionable error before startup', async () => {
  const result = await run(0, 5173);
  assert.equal(result.code, 1);
  assert.match(result.output, /must be valid ports/);
});
