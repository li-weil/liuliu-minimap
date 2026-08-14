const { callApi } = require('./api');

function recommendSpots(lat, lng, excludeNames = []) {
  return callApi('dongaoRecommend', { lat, lng, excludeNames });
}

function generateMission(mapName, preference = '') {
  return callApi('dongaoGenerate', { map_name: mapName, preference });
}

module.exports = {
  recommendSpots,
  generateMission,
};
