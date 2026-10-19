/**
 * EAS Build lifecycle hook to ensure @matinee/shared is built
 * BEFORE Metro runs the production Android / iOS bundle.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Locate monorepo root (3 levels up from apps/mobile/scripts or 2 levels from apps/mobile)
let monorepoRoot = path.resolve(__dirname, '../../..');
if (!fs.existsSync(path.join(monorepoRoot, 'packages/shared'))) {
  monorepoRoot = path.resolve(__dirname, '../..');
}

const sharedDir = path.resolve(monorepoRoot, 'packages/shared');
const distFile = path.resolve(sharedDir, 'dist/index.js');

console.log('📦 [EAS Lifecycle] Building @matinee/shared dependency...');
console.log(`📍 Monorepo root: ${monorepoRoot}`);
console.log(`📍 Shared package directory: ${sharedDir}`);

if (!fs.existsSync(sharedDir)) {
  console.error(`💥 [EAS Lifecycle] Shared package directory not found at: ${sharedDir}`);
  process.exit(1);
}

// Find typescript compiler: prefer local project tsc or node_modules binary
const tscBin = path.resolve(monorepoRoot, 'node_modules/typescript/bin/tsc');
let buildCmd = 'npm run build';
if (fs.existsSync(tscBin)) {
  buildCmd = `node "${tscBin}" -p "${sharedDir}"`;
} else if (process.platform === 'win32') {
  buildCmd = 'npm.cmd run build';
}

console.log(`🔨 Running build command: ${buildCmd}`);

try {
  execSync(buildCmd, {
    cwd: sharedDir,
    stdio: 'inherit',
    env: { ...process.env },
    shell: true,
  });
} catch (err) {
  console.warn('⚠️ Primary build command failed, trying fallback npm run build...');
  execSync('npm run build', {
    cwd: sharedDir,
    stdio: 'inherit',
    env: { ...process.env },
    shell: true,
  });
}

if (!fs.existsSync(distFile)) {
  console.error(`💥 [EAS Lifecycle] Missing output artifact: ${distFile}`);
  process.exit(1);
}

const stats = fs.statSync(distFile);
console.log(`✅ [@matinee/shared] Built successfully (${stats.size} bytes) -> ${distFile}`);
