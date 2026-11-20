const { callApi } = require('./api');

function recommendSpots(lat, lng, excludeNames = []) {
  return callApi('dongaoRecommend', { lat, lng, excludeNames });
}

function generateMission(mapName, preference = '') {
  const profile = require('../utils/userTags').getStoredProfile();
  const tags = profile && Array.isArray(profile.tags) ? profile.tags : [];
  return callApi('dongaoGenerate', { map_name: mapName, preference, tags });
}

function askLiuliu(question, history = []) {
  const tags = require('../utils/userTags').getStoredProfile();
  const tagList = tags && Array.isArray(tags.tags) ? tags.tags : [];
  return callApi('askLiuliu', { question, messages: history, tags: tagList });
}

module.exports = {
  recommendSpots,
  generateMission,
  askLiuliu,
};
