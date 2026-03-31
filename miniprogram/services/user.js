const { callApi } = require('./api');

function syncUser(payload = {}) {
  return callApi('syncUser', payload);
}

module.exports = {
  syncUser,
};
