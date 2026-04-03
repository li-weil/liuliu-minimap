const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const roomId = String(event.roomId || event.id || '').trim();
  const missionKey = String(event.missionKey || '').trim();
  const pending = !!event.pending;
  const timestamp = Number(event.timestamp || Date.now());

  if (!roomId) {
    throw new Error('missing_room_id');
  }
  if (!missionKey) {
    throw new Error('missing_mission_key');
  }

  const memberResult = await db.collection('teamWalkMembers').where({
    roomId,
    userId: openid,
    status: 'joined',
  }).limit(1).get();

  const member = memberResult.data && memberResult.data[0] ? memberResult.data[0] : null;
  if (!member) {
    throw new Error('permission_denied');
  }

  const pendingMissionKeys = Array.isArray(member.pendingMissionKeys)
    ? member.pendingMissionKeys.filter(Boolean)
    : [];
  const nextPendingMissionKeys = pending
    ? Array.from(new Set([...pendingMissionKeys, missionKey]))
    : pendingMissionKeys.filter((item) => item !== missionKey);

  await db.collection('teamWalkMembers').doc(member._id).update({
    data: {
      pendingMissionKeys: nextPendingMissionKeys,
      lastDraftUpdatedAt: pending ? timestamp : (member.lastDraftUpdatedAt || 0),
      lastSyncedAt: pending ? (member.lastSyncedAt || 0) : timestamp,
    },
  });

  return {
    ok: true,
    pendingMissionKeys: nextPendingMissionKeys,
  };
};
