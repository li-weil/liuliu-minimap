const { callApi } = require('./api');

function createWalk(payload) {
  return callApi('createWalk', payload);
}

function listMyWalks(payload = {}) {
  return callApi('listMyWalks', payload);
}

function listPublicWalks(payload = {}) {
  return callApi('listPublicWalks', payload);
}

function getWalkDetail(payload = {}) {
  return callApi('getWalkDetail', payload);
}

function publishWalkShare(payload = {}) {
  return callApi('publishWalkShare', payload);
}

module.exports = {
  createWalk,
  getWalkDetail,
  listMyWalks,
  listPublicWalks,
  publishWalkShare,
};
