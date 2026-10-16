const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const distFile = path.resolve(__dirname, '../dist/db/setup.js');
const srcFile = path.resolve(__dirname, '../src/db/setup.ts');

if (fs.existsSync(distFile)) {
  const result = spawnSync(process.execPath, [distFile], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
} else {
  const result = spawnSync('npx', ['tsx', srcFile], { stdio: 'inherit', shell: true });
  process.exit(result.status ?? 0);
}
