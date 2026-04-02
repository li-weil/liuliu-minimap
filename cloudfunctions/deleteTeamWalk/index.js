const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const roomId = event.roomId || event.id || '';
  const openid = wxContext.OPENID;

  if (!roomId) {
    return { ok: false, reason: 'missing_id' };
  }

  let room = null;
  try {
    const doc = await db.collection('teamWalkRooms').doc(roomId).get();
    room = doc.data || null;
  } catch (error) {
    return { ok: false, reason: 'not_found' };
  }

  if (!room) {
    return { ok: false, reason: 'not_found' };
  }

  const memberResult = await db.collection('teamWalkMembers')
    .where({ roomId, userId: openid, status: 'joined' })
    .limit(1)
    .get();
  const member = (memberResult.data || [])[0] || null;

  if (!member) {
    return { ok: false, reason: 'permission_denied' };
  }

  if (room.status !== 'finished') {
    return { ok: false, reason: 'walk_not_finished' };
  }

  try {
    await Promise.all([
      db.collection('teamWalkRooms').doc(roomId).remove(),
      db.collection('teamWalkMembers').where({ roomId }).remove(),
      db.collection('teamWalkContributions').where({ roomId }).remove(),
      db.collection('teamWalkActivities').where({ roomId }).remove(),
    ]);
  } catch (error) {
    try {
      await db.collection('teamWalkActivities').where({ roomId: _.eq(roomId) }).remove();
    } catch (innerError) {
      // Ignore cleanup fallback failure.
    }
    return { ok: false, reason: 'delete_failed' };
  }

  return {
    ok: true,
    id: roomId,
  };
};
