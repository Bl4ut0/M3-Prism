const fs = require('fs');
const path = require('path');
const {
  canWriteFile,
  fileExists,
  getBundledRuntimeConfigPath,
  getExternalRuntimeConfigPath,
  getFallbackRuntimeConfigPath,
  getLegacyRuntimeConfigPath,
} = require('./runtimePaths');

const DEFAULT_RUNTIME_CONFIG = {
  tmdbApiKey: '',
  userAgent: 'M3Prism/1.0',
  language: 'en-US',
  includeAdult: false,
};

function trimString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function normalizeRuntimeConfig(rawConfig = {}) {
  return {
    tmdbApiKey: trimString(rawConfig.tmdbApiKey || rawConfig.tmdb_api_key, ''),
    userAgent: trimString(rawConfig.userAgent || rawConfig.user_agent, DEFAULT_RUNTIME_CONFIG.userAgent) || DEFAULT_RUNTIME_CONFIG.userAgent,
    language: trimString(rawConfig.language, DEFAULT_RUNTIME_CONFIG.language) || DEFAULT_RUNTIME_CONFIG.language,
    includeAdult: typeof rawConfig.includeAdult === 'boolean'
      ? rawConfig.includeAdult
      : typeof rawConfig.include_adult === 'boolean'
        ? rawConfig.include_adult
        : DEFAULT_RUNTIME_CONFIG.includeAdult,
  };
}

function parseJsonFile(targetPath) {
  try {
    if (!fileExists(targetPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function serializeRuntimeConfig(config) {
  return `${JSON.stringify({
    tmdbApiKey: config.tmdbApiKey,
    userAgent: config.userAgent,
    language: config.language,
    includeAdult: config.includeAdult,
  }, null, 2)}\n`;
}

function getCurrentConfigFile() {
  const fallbackPath = getFallbackRuntimeConfigPath();
  if (fileExists(fallbackPath)) {
    return { path: fallbackPath, source: 'userData' };
  }

  const externalPath = getExternalRuntimeConfigPath();
  if (fileExists(externalPath)) {
    return { path: externalPath, source: 'external' };
  }

  const bundledPath = getBundledRuntimeConfigPath();
  if (fileExists(bundledPath)) {
    return { path: bundledPath, source: 'bundled' };
  }

  return null;
}

function getWritableTargetPath(preferredExistingPath) {
  const externalPath = getExternalRuntimeConfigPath();
  const fallbackPath = getFallbackRuntimeConfigPath();

  if (preferredExistingPath && canWriteFile(preferredExistingPath)) {
    return {
      path: preferredExistingPath,
      source: preferredExistingPath === externalPath ? 'external' : 'userData',
    };
  }

  if (externalPath !== getBundledRuntimeConfigPath() && canWriteFile(externalPath)) {
    return { path: externalPath, source: 'external' };
  }

  return { path: fallbackPath, source: 'userData' };
}

function ensureRuntimeConfig() {
  const existingConfigFile = getCurrentConfigFile();
  if (existingConfigFile) {
    return {
      config: normalizeRuntimeConfig(parseJsonFile(existingConfigFile.path)),
      path: existingConfigFile.path,
      source: existingConfigFile.source,
      preferredPath: getExternalRuntimeConfigPath(),
      fallbackPath: getFallbackRuntimeConfigPath(),
    };
  }

  const legacyConfig = normalizeRuntimeConfig(parseJsonFile(getLegacyRuntimeConfigPath()) || {});
  const seedConfig = {
    ...DEFAULT_RUNTIME_CONFIG,
    ...legacyConfig,
  };
  const writableTarget = getWritableTargetPath(null);

  fs.writeFileSync(writableTarget.path, serializeRuntimeConfig(seedConfig), 'utf8');

  return {
    config: seedConfig,
    path: writableTarget.path,
    source: writableTarget.source,
    preferredPath: getExternalRuntimeConfigPath(),
    fallbackPath: getFallbackRuntimeConfigPath(),
  };
}

function getRuntimeConfig() {
  const runtimeConfig = ensureRuntimeConfig();

  return {
    ...runtimeConfig,
    config: {
      ...runtimeConfig.config,
      tmdbApiKey: trimString(process.env.TMDB_API_KEY, runtimeConfig.config.tmdbApiKey),
      userAgent: trimString(process.env.WEBPLAYER_USER_AGENT, runtimeConfig.config.userAgent) || DEFAULT_RUNTIME_CONFIG.userAgent,
      language: trimString(process.env.WEBPLAYER_LANGUAGE, runtimeConfig.config.language) || DEFAULT_RUNTIME_CONFIG.language,
      includeAdult: typeof process.env.WEBPLAYER_INCLUDE_ADULT === 'string'
        ? process.env.WEBPLAYER_INCLUDE_ADULT.toLowerCase() === 'true'
        : runtimeConfig.config.includeAdult,
    },
  };
}

function updateRuntimeConfig(partialConfig = {}) {
  const currentRuntimeConfig = getRuntimeConfig();
  const writableTarget = getWritableTargetPath(currentRuntimeConfig.path);
  const nextConfig = normalizeRuntimeConfig({
    ...currentRuntimeConfig.config,
    ...partialConfig,
  });

  fs.writeFileSync(writableTarget.path, serializeRuntimeConfig(nextConfig), 'utf8');

  return {
    config: nextConfig,
    path: writableTarget.path,
    source: writableTarget.source,
    preferredPath: getExternalRuntimeConfigPath(),
    fallbackPath: getFallbackRuntimeConfigPath(),
  };
}

module.exports = {
  DEFAULT_RUNTIME_CONFIG,
  getRuntimeConfig,
  updateRuntimeConfig,
};
