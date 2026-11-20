const { callApi } = require('./api');

function listMyAchievements(payload = {}) {
  return callApi('listMyAchievements', payload);
}

module.exports = {
  listMyAchievements,
};
