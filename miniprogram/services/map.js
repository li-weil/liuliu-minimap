const { callApi, getBackendProvider } = require('./api');
const { searchAmapPois } = require('../utils/amap');

function searchLocations(query, location = null) {
  if (getBackendProvider() === 'web') {
    return callApi('searchLocations', { query });
  }

  return searchAmapPois({ keyword: query, location });
}

function fetchNearbyPois(lat, lng) {
  return callApi('fetchNearbyPois', { lat, lng });
}

function getLocationContext(payload) {
  return callApi('getLocationContext', payload);
}

module.exports = {
  fetchNearbyPois,
  getLocationContext,
  searchLocations,
};
