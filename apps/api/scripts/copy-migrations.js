const fs = require('fs');
const path = require('path');

const srcMigrationsDir = path.resolve(__dirname, '../src/db/migrations');
const destMigrationsDir = path.resolve(__dirname, '../dist/db/migrations');

if (fs.existsSync(srcMigrationsDir)) {
  fs.mkdirSync(destMigrationsDir, { recursive: true });
  fs.cpSync(srcMigrationsDir, destMigrationsDir, { recursive: true });
  console.log(`✅ [copy-migrations] Copied migrations from ${srcMigrationsDir} to ${destMigrationsDir}`);
} else {
  console.warn(`⚠️ [copy-migrations] Warning: Source migrations dir does not exist: ${srcMigrationsDir}`);
}

// Copy schema.sql if present
const srcSchema = path.resolve(__dirname, '../src/db/schema.sql');
const destSchema = path.resolve(__dirname, '../dist/db/schema.sql');
if (fs.existsSync(srcSchema)) {
  fs.mkdirSync(path.dirname(destSchema), { recursive: true });
  fs.copyFileSync(srcSchema, destSchema);
  console.log(`✅ [copy-migrations] Copied schema.sql to dist/db`);
}
