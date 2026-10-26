import './testEnv';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEnvironment,
  validateJwtSecret,
  DEFAULT_DEV_JWT_SECRET,
} from '../config/env';

test('Production environment validation: refuses to start when JWT_SECRET is missing', () => {
  const result = validateEnvironment({
    NODE_ENV: 'production',
  });

  assert.equal(result.success, false, 'Production configuration must fail when JWT_SECRET is omitted');
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path.includes('JWT_SECRET'));
    assert.ok(issue, 'Must contain a validation issue on JWT_SECRET');
    assert.match(issue!.message, /required in production/i);
  }
});

test('Production environment validation: refuses to start when JWT_SECRET is empty or whitespace', () => {
  const result = validateEnvironment({
    NODE_ENV: 'production',
    JWT_SECRET: '   ',
  });

  assert.equal(result.success, false, 'Production configuration must fail when JWT_SECRET is whitespace');
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path.includes('JWT_SECRET'));
    assert.ok(issue);
    assert.match(issue!.message, /required in production/i);
  }
});

test('Production environment validation: refuses to start when JWT_SECRET is set to development default', () => {
  const result = validateEnvironment({
    NODE_ENV: 'production',
    JWT_SECRET: DEFAULT_DEV_JWT_SECRET,
  });

  assert.equal(result.success, false, 'Production configuration must fail with default dev secret');
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path.includes('JWT_SECRET'));
    assert.ok(issue);
    assert.match(issue!.message, /must not use development default/i);
  }
});

test('Production environment validation: refuses to start when JWT_SECRET is set to .env.example placeholder', () => {
  const result = validateEnvironment({
    NODE_ENV: 'production',
    JWT_SECRET: 'replace-with-a-unique-random-secret-at-least-32-characters',
  });

  assert.equal(result.success, false, 'Production configuration must fail with .env.example placeholder');
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path.includes('JWT_SECRET'));
    assert.ok(issue);
    assert.match(issue!.message, /must not use development default or known insecure/i);
  }
});

test('Production environment validation: refuses to start when JWT_SECRET is too short (< 32 characters)', () => {
  const result = validateEnvironment({
    NODE_ENV: 'production',
    JWT_SECRET: 'short-secret-1234567890',
  });

  assert.equal(result.success, false, 'Production configuration must fail when secret length < 32');
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path.includes('JWT_SECRET'));
    assert.ok(issue);
    assert.match(issue!.message, /too weak/i);
    assert.match(issue!.message, /at least 32 characters/i);
  }
});

test('Production environment validation: refuses to start when JWT_SECRET has insufficient entropy or trivial pattern', () => {
  const result = validateEnvironment({
    NODE_ENV: 'production',
    JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });

  assert.equal(result.success, false, 'Production configuration must fail for low-entropy trivial patterns');
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path.includes('JWT_SECRET'));
    assert.ok(issue);
    assert.match(issue!.message, /insufficient entropy/i);
  }
});

test('Production environment validation: succeeds when JWT_SECRET is a strong random 32+ character key', () => {
  const strongSecret = 'c9d74f2b1a8e6305a4d9e2b8c715f03a62e4d9c7b1a8e6305a4d9e2b8c715f03';
  const result = validateEnvironment({
    NODE_ENV: 'production',
    JWT_SECRET: strongSecret,
  });

  assert.equal(result.success, true, 'Production configuration must succeed with strong secret');
  if (result.success) {
    assert.equal(result.data.JWT_SECRET, strongSecret);
  }
});

test('Development environment: preserves local development functionality when JWT_SECRET is unset', () => {
  const result = validateEnvironment({
    NODE_ENV: 'development',
  });

  assert.equal(result.success, true, 'Development must succeed when JWT_SECRET is omitted');
  if (result.success) {
    assert.equal(result.data.JWT_SECRET, DEFAULT_DEV_JWT_SECRET, 'Should default to development secret');
  }
});

test('Test environment: preserves test functionality when JWT_SECRET is unset', () => {
  const result = validateEnvironment({
    NODE_ENV: 'test',
  });

  assert.equal(result.success, true, 'Test environment must succeed when JWT_SECRET is omitted');
  if (result.success) {
    assert.equal(result.data.JWT_SECRET, DEFAULT_DEV_JWT_SECRET);
  }
});

test('Development environment: accepts custom JWT_SECRET when explicitly provided', () => {
  const devSecret = 'my-custom-dev-secret-key-1234567';
  const result = validateEnvironment({
    NODE_ENV: 'development',
    JWT_SECRET: devSecret,
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.JWT_SECRET, devSecret);
  }
});

test('validateJwtSecret helper function: comprehensive unit validation', () => {
  // In dev/test, any or no secret is valid
  assert.equal(validateJwtSecret(undefined, 'development').valid, true);
  assert.equal(validateJwtSecret(DEFAULT_DEV_JWT_SECRET, 'test').valid, true);

  // In production, invalid cases
  assert.equal(validateJwtSecret(undefined, 'production').valid, false);
  assert.equal(validateJwtSecret('', 'production').valid, false);
  assert.equal(validateJwtSecret(DEFAULT_DEV_JWT_SECRET, 'production').valid, false);
  assert.equal(validateJwtSecret('short-secret', 'production').valid, false);
  assert.equal(validateJwtSecret('11111111111111111111111111111111', 'production').valid, false);

  // In production, valid strong case
  assert.equal(
    validateJwtSecret('f47ac10b-58cc-4372-a567-0e02b2c3d479-super-secret-key-prod', 'production').valid,
    true
  );
});
