import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const apiPort = Number(process.env.PORT || 3001);
const clientPort = Number(process.env.VITE_PORT || 5173);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const clientUrl = `http://127.0.0.1:${clientPort}`;
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function launch(args) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  return child;
}
function available(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error) => (error.code === 'EADDRINUSE' ? resolve(false) : reject(error)));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () =>
      probe.close(() => resolve(true)),
    );
  });
}
async function healthy() {
  try {
    const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    const data = await response.json();
    return response.ok && data.status === 'ok' && data.database === 'PostgreSQL';
  } catch {
    return false;
  }
}
async function main() {
  for (const port of [apiPort, clientPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('PORT and VITE_PORT must be valid ports (1–65535).');
  }
  if (apiPort === clientPort) throw new Error('PORT and VITE_PORT must be different.');
  const [apiFree, clientFree] = await Promise.all([available(apiPort), available(clientPort)]);
  if (!apiFree && !clientFree && (await healthy())) {
    const page = await fetch(clientUrl, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.text())
      .catch(() => '');
    if (page.includes('<title>eDTR') || page.includes('<title>VioTech')) {
      console.log(`eDTR is already running. Open ${clientUrl}/`);
      return;
    }
  }
  if (!apiFree || !clientFree) {
    throw new Error(
      `Port ${!apiFree ? apiPort : clientPort} is already in use. Stop the terminal running that service, then run npm.cmd run dev again.`,
    );
  }
  const setup = launch(['--import', 'tsx', 'scripts/setup.ts']);
  const setupCode = await new Promise((resolve) => setup.once('exit', resolve));
  if (setupCode !== 0) return stop(1);
  const server = launch(['--import', 'tsx', '--watch', 'server/index.ts']);
  server.once('exit', (code) => stop(code ?? 1));
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await healthy()) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready)
    throw new Error('The eDTR API did not become ready. Check the database and API output above.');
  const client = launch([
    'node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--port',
    String(clientPort),
  ]);
  client.once('exit', (code) => stop(code ?? 1));
}
main().catch((error) => {
  console.error(error.message);
  stop(1);
});
