const { callApi } = require('./api');

function createTeamRoom(payload = {}) {
  return callApi('createTeamRoom', payload);
}

function getTeamRoomDetail(payload = {}) {
  return callApi('getTeamRoomDetail', payload);
}

function joinTeamRoom(payload = {}) {
  return callApi('joinTeamRoom', payload);
}

function leaveTeamRoom(payload = {}) {
  return callApi('leaveTeamRoom', payload);
}

function startTeamWalk(payload = {}) {
  return callApi('startTeamWalk', payload);
}

function submitTeamContribution(payload = {}) {
  return callApi('submitTeamContribution', payload);
}

function listTeamActivities(payload = {}) {
  return callApi('listTeamActivities', payload);
}

function finishTeamWalk(payload = {}) {
  return callApi('finishTeamWalk', payload);
}

function getTeamWalkDetail(payload = {}) {
  return callApi('getTeamWalkDetail', payload);
}

function listMyTeamWalks(payload = {}) {
  return callApi('listMyTeamWalks', payload);
}

module.exports = {
  createTeamRoom,
  finishTeamWalk,
  getTeamRoomDetail,
  getTeamWalkDetail,
  joinTeamRoom,
  leaveTeamRoom,
  listMyTeamWalks,
  listTeamActivities,
  startTeamWalk,
  submitTeamContribution,
};
