// Imported first by every test file. Forces the in-memory demo store so the
// regression suite never touches PostgreSQL/Redis, regardless of the local
// .env. `resolveDataMode()` reads process.env before the parsed env, and
// dotenv does not override already-set variables.
process.env.DATA_MODE = 'memory';
process.env.NODE_ENV = 'test';
