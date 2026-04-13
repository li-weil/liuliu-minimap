const { callApi } = require('./api');

function generateTheme(payload) {
  return callApi('generateTheme', payload);
}

function generateCombinedTheme(payload) {
  return callApi('generateCombinedTheme', payload);
}

function verifyMission(payload) {
  return callApi('verifyMission', payload);
}

module.exports = {
  generateCombinedTheme,
  generateTheme,
  verifyMission,
};
