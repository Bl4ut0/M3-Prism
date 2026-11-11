const axios = require('axios');
const { DEFAULT_RUNTIME_CONFIG, getRuntimeConfig } = require('./runtimeConfig');

function getDefaultUserAgent() {
  return getRuntimeConfig().config.userAgent || DEFAULT_RUNTIME_CONFIG.userAgent;
}

function buildHeaders(headers = {}) {
  const explicitUserAgent = headers['User-Agent'] || headers['user-agent'];

  return {
    ...headers,
    'User-Agent': explicitUserAgent || getDefaultUserAgent(),
  };
}

function request(config = {}) {
  return axios({
    ...config,
    headers: buildHeaders(config.headers),
  });
}

function get(url, config = {}) {
  return request({
    ...config,
    method: 'get',
    url,
  });
}

module.exports = {
  get,
  getDefaultUserAgent,
  request,
};
