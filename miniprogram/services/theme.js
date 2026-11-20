const { callApi } = require('./api');

function generateTheme(payload) {
  return callApi('generateTheme', payload);
}

function generateCombinedTheme(payload) {
  return callApi('generateCombinedTheme', payload);
}

module.exports = {
  generateCombinedTheme,
  generateTheme,
};
