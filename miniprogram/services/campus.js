const { callApi } = require('./api');

function recommendSpots(lat, lng, tag = '', excludeNames = []) {
  return callApi('campusRecommend', { lat, lng, tag, excludeNames });
}

function generateMission(mapName, tag = '景点', lastTask = '') {
  return callApi('campusGenerate', { map_name: mapName, tag, lastTask });
}

module.exports = {
  recommendSpots,
  generateMission,
};
