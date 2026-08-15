const { callApi } = require('./api');

function recommendSpots(lat, lng, tag = '', excludeNames = []) {
  return callApi('campusRecommend', { lat, lng, tag, excludeNames });
}

function generateMission(mapName, tag = '景点') {
  return callApi('campusGenerate', { map_name: mapName, tag });
}

module.exports = {
  recommendSpots,
  generateMission,
};
