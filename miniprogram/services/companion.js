const { callApi } = require('./api');

function generateCompanionNote(payload) {
  return callApi('generateCompanionNote', payload);
}

module.exports = {
  generateCompanionNote,
};
