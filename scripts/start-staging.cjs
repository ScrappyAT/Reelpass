const { spawn } = require('node:child_process');
const { join } = require('node:path');

if (process.env.DATA_MODE !== 'postgres' || !process.env.DATABASE_URL || !process.env.REDIS_URL) {
  console.error('Staging requires DATA_MODE=postgres, DATABASE_URL and REDIS_URL.');
  process.exit(1);
}

const children = new Set();
let stopping = false;

function stop(failed) {
  if (stopping) return;
  stopping = true;
  process.exitCode = failed ? 1 : 0;
  for (const child of children) child.kill('SIGTERM');
  if (children.size) {
    setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
    }, 25_000).unref();
  }
}

for (const entry of ['index', 'worker']) {
  const file = join(__dirname, '..', 'apps', 'api', 'dist', entry + '.js');
  const child = spawn(process.execPath, [file], { stdio: 'inherit' });
  children.add(child);
  child.once('error', error => {
    children.delete(child);
    console.error(JSON.stringify({ event: 'staging_process_start_failed', entry, code: error.code }));
    stop(true);
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.error(JSON.stringify({ event: 'staging_process_exited', entry, code, signal }));
    stop(true);
  });
}

process.on('SIGTERM', () => stop(false));
process.on('SIGINT', () => stop(false));
