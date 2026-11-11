const fs = require('fs');
const path = require('path');

// PROJECT_ROOT is /app
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');

function getEnvironmentPath(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
}

function fileExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch (error) {
    return false;
  }
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

function canWriteFile(targetPath) {
  try {
    ensureDir(path.dirname(targetPath));
    if (fileExists(targetPath)) {
      fs.accessSync(targetPath, fs.constants.W_OK);
    } else {
      fs.accessSync(path.dirname(targetPath), fs.constants.W_OK);
    }
    return true;
  } catch (error) {
    return false;
  }
}

function getProjectRoot() {
  return PROJECT_ROOT;
}

function getExecutableRoot() {
  return getEnvironmentPath('EXE_DIR') || CONFIG_DIR;
}

function getUserDataRoot() {
  const explicitUserDataDir = getEnvironmentPath('USER_DATA_DIR');
  const explicitDatabasePath = getEnvironmentPath('DB_PATH');
  return ensureDir(explicitUserDataDir || (explicitDatabasePath && path.dirname(explicitDatabasePath)) || CONFIG_DIR);
}

function getDatabasePath() {
  const databasePath = getEnvironmentPath('DB_PATH') || path.join(getUserDataRoot(), 'user_data.db');
  ensureDir(path.dirname(databasePath));
  return databasePath;
}

function getCacheDir() {
  return ensureDir(getEnvironmentPath('CACHE_DIR') || path.join(getUserDataRoot(), 'cache', 'assets'));
}

function getLegacyRuntimeConfigPath() {
  return path.join(CONFIG_DIR, 'server.json');
}

function getExternalRuntimeConfigPath() {
  return path.join(getExecutableRoot(), 'main.json');
}

function getFallbackRuntimeConfigPath() {
  return path.join(getUserDataRoot(), 'main.json');
}

function getBundledRuntimeConfigPath() {
  return path.join(CONFIG_DIR, 'main.json');
}

function getProviderConfigPaths() {
  return {
    externalPath: path.join(getExecutableRoot(), 'providers.json'),
    userDataPath: path.join(getUserDataRoot(), 'providers.json'),
    bundledPath: path.join(CONFIG_DIR, 'providers.json'),
    legacyPath: path.join(PROJECT_ROOT, 'providers.json'),
  };
}

function getProviderConfigPath() {
  const paths = getProviderConfigPaths();
  return [...new Set([paths.externalPath, paths.userDataPath, paths.bundledPath, paths.legacyPath])]
    .find(fileExists) || null;
}

module.exports = {
  canWriteFile,
  ensureDir,
  fileExists,
  getCacheDir,
  getBundledRuntimeConfigPath,
  getDatabasePath,
  getExecutableRoot,
  getExternalRuntimeConfigPath,
  getFallbackRuntimeConfigPath,
  getLegacyRuntimeConfigPath,
  getProjectRoot,
  getProviderConfigPath,
  getProviderConfigPaths,
  getUserDataRoot,
};
