const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtimePaths = require('../runtimePaths');
const { decryptSecret, encryptSecret, JWT_SECRET } = require('../cryptoUtils');

const originalEnvironment = { ...process.env };
const testRoot = path.join(runtimePaths.getProjectRoot(), '.runtime-test-data');

test.afterEach(() => {
  process.env = { ...originalEnvironment };
});

test.after(() => {
  const resolvedTestRoot = path.resolve(testRoot);
  const resolvedProjectRoot = path.resolve(runtimePaths.getProjectRoot());
  assert.ok(resolvedTestRoot.startsWith(`${resolvedProjectRoot}${path.sep}`));
  fs.rmSync(resolvedTestRoot, { recursive: true, force: true });
});

test('runtime paths honor web-service persistence environment variables', () => {
  process.env.DB_PATH = path.join(testRoot, 'web', 'profiles.db');
  process.env.USER_DATA_DIR = path.join(testRoot, 'web');
  process.env.CACHE_DIR = path.join(testRoot, 'web', 'artwork');

  assert.equal(runtimePaths.getDatabasePath(), path.resolve(process.env.DB_PATH));
  assert.equal(runtimePaths.getUserDataRoot(), path.resolve(process.env.USER_DATA_DIR));
  assert.equal(runtimePaths.getCacheDir(), path.resolve(process.env.CACHE_DIR));
  assert.ok(fs.existsSync(path.dirname(runtimePaths.getDatabasePath())));
  assert.ok(fs.existsSync(runtimePaths.getCacheDir()));
});

test('desktop-provided database paths remain distinct from project config', () => {
  process.env.DB_PATH = path.join(testRoot, 'desktop', 'user_data.db');
  process.env.USER_DATA_DIR = path.join(testRoot, 'desktop');

  assert.equal(runtimePaths.getDatabasePath(), path.resolve(process.env.DB_PATH));
  assert.notEqual(runtimePaths.getDatabasePath(), path.join(runtimePaths.getProjectRoot(), 'config', 'user_data.db'));
});

test('profile secrets use randomized authenticated encryption and retain legacy compatibility', () => {
  const first = encryptSecret('profile-password');
  const second = encryptSecret('profile-password');

  assert.match(first, /^v2:/);
  assert.notEqual(first, second);
  assert.equal(decryptSecret(first), 'profile-password');
  assert.equal(decryptSecret(second), 'profile-password');

  const key = crypto.createHash('sha256').update(JWT_SECRET).digest();
  const legacyCipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16, 0));
  const legacyValue = legacyCipher.update('legacy-password', 'utf8', 'hex') + legacyCipher.final('hex');
  assert.equal(decryptSecret(legacyValue), 'legacy-password');
});
