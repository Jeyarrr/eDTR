import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function configRun(overrides: Record<string, string>) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "const {config}=await import('./server/config.ts'); console.log(config.appUrl);",
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: '.local/nonexistent-test-env',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:placeholder@localhost/test',
        SESSION_SECRET: 'test-only-session-secret-with-32-characters',
        APP_URL: 'https://attendance.example.com',
        ...overrides,
      },
    },
  );
}
test('production requires an explicit HTTPS application origin and strong session secret', () => {
  for (const APP_URL of [
    '',
    'http://localhost:5173',
    'https://example.com/path',
    'https://example.com?bad=1',
  ])
    assert.notEqual(configRun({ APP_URL }).status, 0);
  assert.notEqual(configRun({ SESSION_SECRET: 'short' }).status, 0);
  assert.equal(
    configRun({ APP_URL: 'https://attendance.example.com/' }).stdout.trim(),
    'https://attendance.example.com',
  );
});
