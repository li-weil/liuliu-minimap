const { callApi } = require('./api');

function recommendSpots(lat, lng, excludeNames = []) {
  return callApi('dongaoRecommend', { lat, lng, excludeNames });
}

function generateMission(mapName, options = {}) {
  return callApi('dongaoGenerate', {
    map_name: mapName,
    preference: options.preference || 'general',
    recentMissions: Array.isArray(options.recentMissions) ? options.recentMissions.slice(0, 3) : [],
  });
}

module.exports = {
  recommendSpots,
  generateMission,
};
